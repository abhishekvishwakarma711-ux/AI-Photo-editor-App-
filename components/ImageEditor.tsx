import React, { useState, useRef, useEffect, useCallback } from 'react';
import { editImageWithMask, upscaleImage, generateBackgroundMask } from '../services/geminiService';
import { fileToBase64 } from '../utils/imageUtils';
import { Point } from '../types';
import Spinner from './Spinner';
import { BrushIcon, EraserIcon, ResetIcon, DownloadIcon, BackIcon, ExpandIcon, AutoMaskIcon, RectangleIcon, CircleIcon, FillIcon } from './Icons';

interface ImageEditorProps {
  originalImage: File;
  onReset: () => void;
}

type Tool = 'brush' | 'eraser' | 'rectangle' | 'circle' | 'fill';

const MAX_DIMENSION = 1024;

const ImageEditor: React.FC<ImageEditorProps> = ({ originalImage, onReset }) => {
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [style, setStyle] = useState('Default');
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brushSize, setBrushSize] = useState(40);
  const [brushOpacity, setBrushOpacity] = useState(0.7);
  const [activeTool, setActiveTool] = useState<Tool>('brush');
  const [isMasking, setIsMasking] = useState(false);
  
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledImage, setUpscaledImage] = useState<string | null>(null);

  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);

  const isDrawing = useRef(false);
  const lastPoint = useRef<Point | null>(null);
  const shapeStartPoint = useRef<Point | null>(null);
  const canvasSnapshot = useRef<ImageData | null>(null);

  const resizeImage = (img: HTMLImageElement): { width: number, height: number } => {
    const { width, height } = img;
    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
            return { width: MAX_DIMENSION, height: Math.round(height * (MAX_DIMENSION / width)) };
        } else {
            return { width: Math.round(width * (MAX_DIMENSION / height)), height: MAX_DIMENSION };
        }
    }
    return { width, height };
  };

  const drawImageOnCanvas = useCallback(() => {
    const img = new Image();
    img.src = URL.createObjectURL(originalImage);
    img.onload = () => {
        const { width, height } = resizeImage(img);
        
        [imageCanvasRef, drawingCanvasRef].forEach(ref => {
            if (ref.current) {
                ref.current.width = width;
                ref.current.height = height;
            }
        });

        const imageCtx = imageCanvasRef.current?.getContext('2d');
        if (imageCtx) {
            imageCtx.drawImage(img, 0, 0, width, height);
        }
    };
    img.onerror = () => setError("Failed to load image.");
  }, [originalImage]);

  useEffect(() => {
    drawImageOnCanvas();
  }, [drawImageOnCanvas]);

  const getMousePos = (canvas: HTMLCanvasElement, e: MouseEvent | TouchEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    const touch = 'touches' in e ? e.touches[0] : e;
    return {
      x: (touch.clientX - rect.left) / (rect.right - rect.left) * canvas.width,
      y: (touch.clientY - rect.top) / (rect.bottom - rect.top) * canvas.height,
    };
  };

  const drawLine = (start: Point, end: Point) => {
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = brushSize;
    ctx.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = `rgba(192, 132, 252, ${brushOpacity})`;
    
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  };
  
  const drawShape = (start: Point, end: Point) => {
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(192, 132, 252, ${brushOpacity})`;
    ctx.strokeStyle = `rgba(192, 132, 252, ${brushOpacity})`;
    ctx.lineWidth = 2; // for outline if needed

    const width = end.x - start.x;
    const height = end.y - start.y;

    if (activeTool === 'rectangle') {
        ctx.fillRect(start.x, start.y, width, height);
    } else if (activeTool === 'circle') {
        const radiusX = Math.abs(width) / 2;
        const radiusY = Math.abs(height) / 2;
        const centerX = start.x + width / 2;
        const centerY = start.y + height / 2;
        
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.fill();
    }
  };

  const floodFill = (startPos: Point) => {
    const imageCanvas = imageCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!imageCanvas || !drawingCanvas) return;

    const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
    const drawingCtx = drawingCanvas.getContext('2d');
    if (!imageCtx || !drawingCtx) return;

    const { width, height } = imageCanvas;
    const startX = Math.floor(startPos.x);
    const startY = Math.floor(startPos.y);

    const imageData = imageCtx.getImageData(0, 0, width, height);
    const drawingImageData = drawingCtx.getImageData(0, 0, width, height);
    
    const pixelStack = [[startX, startY]];
    const startIdx = (startY * width + startX) * 4;
    const startR = imageData.data[startIdx];
    const startG = imageData.data[startIdx + 1];
    const startB = imageData.data[startIdx + 2];
    
    const fillColor = [192, 132, 252, Math.round(255 * brushOpacity)];
    const tolerance = 30;

    const visited = new Uint8Array(width * height);

    while (pixelStack.length > 0) {
        const [x, y] = pixelStack.pop()!;
        
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        
        const visitedIdx = y * width + x;
        if (visited[visitedIdx]) continue;
        visited[visitedIdx] = 1;

        const currentIdx = visitedIdx * 4;
        
        // Skip if already masked
        if (drawingImageData.data[currentIdx + 3] > 0) continue;

        const r = imageData.data[currentIdx];
        const g = imageData.data[currentIdx + 1];
        const b = imageData.data[currentIdx + 2];

        if (Math.abs(r - startR) <= tolerance && Math.abs(g - startG) <= tolerance && Math.abs(b - startB) <= tolerance) {
            drawingImageData.data[currentIdx] = fillColor[0];
            drawingImageData.data[currentIdx + 1] = fillColor[1];
            drawingImageData.data[currentIdx + 2] = fillColor[2];
            drawingImageData.data[currentIdx + 3] = fillColor[3];
            
            pixelStack.push([x + 1, y]);
            pixelStack.push([x - 1, y]);
            pixelStack.push([x, y + 1]);
            pixelStack.push([x, y - 1]);
        }
    }
    
    drawingCtx.putImageData(drawingImageData, 0, 0);
};

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    const pos = getMousePos(drawingCanvasRef.current!, e.nativeEvent);
    
    if (activeTool === 'fill') {
        floodFill(pos);
        return;
    }
    
    isDrawing.current = true;
    
    if (activeTool === 'brush' || activeTool === 'eraser') {
        lastPoint.current = pos;
    } else if (activeTool === 'rectangle' || activeTool === 'circle') {
        shapeStartPoint.current = pos;
        const ctx = drawingCanvasRef.current?.getContext('2d');
        if (ctx) {
            canvasSnapshot.current = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
    }
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current) return;
    const currentPos = getMousePos(drawingCanvasRef.current!, e.nativeEvent);

    if (activeTool === 'brush' || activeTool === 'eraser') {
        if (lastPoint.current) {
            drawLine(lastPoint.current, currentPos);
        }
        lastPoint.current = currentPos;
    } else if (activeTool === 'rectangle' || activeTool === 'circle') {
        if (shapeStartPoint.current) {
            const ctx = drawingCanvasRef.current?.getContext('2d');
            if (ctx && canvasSnapshot.current) {
                ctx.putImageData(canvasSnapshot.current, 0, 0);
                drawShape(shapeStartPoint.current, currentPos);
            }
        }
    }
  };

  const handleMouseUp = () => {
    isDrawing.current = false;
    lastPoint.current = null;
    shapeStartPoint.current = null;
    canvasSnapshot.current = null;
  };
  
  const clearDrawing = () => {
    const canvas = drawingCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleAutoMask = async () => {
    setIsMasking(true);
    setError(null);
    try {
        const originalImageBase64 = await fileToBase64(originalImage);
        const maskBase64 = await generateBackgroundMask(originalImageBase64, originalImage.type);

        const maskImage = new Image();
        maskImage.src = `data:image/png;base64,${maskBase64}`;
        maskImage.onload = () => {
            const canvas = drawingCanvasRef.current;
            const ctx = canvas?.getContext('2d');
            if (!canvas || !ctx) {
                setError("Drawing canvas not available.");
                setIsMasking(false);
                return;
            }

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) {
                setError("Could not create temp canvas context.");
                setIsMasking(false);
                return;
            }

            tempCtx.drawImage(maskImage, 0, 0, tempCanvas.width, tempCanvas.height);
            
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const isWhite = data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200;
                if (isWhite) {
                    data[i] = 192;
                    data[i+1] = 132;
                    data[i+2] = 252;
                    data[i+3] = 255 * brushOpacity;
                } else {
                    data[i+3] = 0;
                }
            }
            tempCtx.putImageData(imageData, 0, 0);

            clearDrawing();
            ctx.drawImage(tempCanvas, 0, 0);
            
            setIsMasking(false);
        };
        maskImage.onerror = () => {
            setError("Failed to load the generated mask.");
            setIsMasking(false);
        }
    } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate background mask.');
        setIsMasking(false);
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);
    setEditedImage(null);
    setUpscaledImage(null);

    const imageCanvas = imageCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;

    if (!imageCanvas || !drawingCanvas || !prompt.trim()) {
      setError('Please draw a mask and enter a prompt.');
      setIsLoading(false);
      return;
    }
    
    // Create mask
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = drawingCanvas.width;
    maskCanvas.height = drawingCanvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    if(!maskCtx) {
        setError("Could not create mask context.");
        setIsLoading(false);
        return;
    }

    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    maskCtx.drawImage(drawingCanvas, 0, 0);

    const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) { // If pixel is not transparent
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      }
    }
    maskCtx.putImageData(imageData, 0, 0);

    try {
        const originalImageBase64 = await fileToBase64(originalImage);
        const maskImageBase64 = maskCanvas.toDataURL('image/png').split(',')[1];
        
        const resultBase64 = await editImageWithMask(prompt, negativePrompt, style, originalImageBase64, originalImage.type, maskImageBase64);
        
        setEditedImage(`data:image/png;base64,${resultBase64}`);

    } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleUpscale = async () => {
    if (!editedImage) {
      setError("Generate an image before upscaling.");
      return;
    }
    setIsUpscaling(true);
    setError(null);
    try {
      const base64Data = editedImage.split(',')[1];
      const resultBase64 = await upscaleImage(base64Data, upscaleFactor);
      setUpscaledImage(`data:image/png;base64,${resultBase64}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred during upscaling.');
    } finally {
      setIsUpscaling(false);
    }
  };
  
  const cursorStyle = () => {
    switch (activeTool) {
      case 'brush':
      case 'eraser':
      case 'rectangle':
      case 'circle':
        return 'cursor-crosshair';
      case 'fill':
        return 'cursor-pointer'; // A custom bucket cursor would be better, but this is simple
      default:
        return 'cursor-default';
    }
  };


  return (
    <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="w-full flex flex-col items-center gap-4">
                <h2 className="text-xl font-semibold text-gray-300 self-start">1. Mask Your Image</h2>
                <div className="relative w-full aspect-auto rounded-lg overflow-hidden border border-gray-700 shadow-lg">
                    <canvas ref={imageCanvasRef} className="absolute top-0 left-0 w-full h-full" />
                    <canvas 
                        ref={drawingCanvasRef}
                        className={`relative w-full h-full touch-none ${cursorStyle()}`}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                        onTouchStart={handleMouseDown}
                        onTouchMove={handleMouseMove}
                        onTouchEnd={handleMouseUp}
                    />
                </div>
                 <div className="w-full bg-gray-900/50 p-3 rounded-lg flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setActiveTool('brush')} className={`p-2 rounded-md transition-all duration-200 transform hover:scale-110 ${activeTool === 'brush' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-700 hover:bg-gray-600'}`} title="Brush">
                            <BrushIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setActiveTool('eraser')} className={`p-2 rounded-md transition-all duration-200 transform hover:scale-110 ${activeTool === 'eraser' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-700 hover:bg-gray-600'}`} title="Eraser">
                            <EraserIcon className="w-5 h-5" />
                        </button>
                         <button onClick={() => setActiveTool('rectangle')} className={`p-2 rounded-md transition-all duration-200 transform hover:scale-110 ${activeTool === 'rectangle' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-700 hover:bg-gray-600'}`} title="Rectangle Tool">
                            <RectangleIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setActiveTool('circle')} className={`p-2 rounded-md transition-all duration-200 transform hover:scale-110 ${activeTool === 'circle' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-700 hover:bg-gray-600'}`} title="Circle Tool">
                            <CircleIcon className="w-5 h-5" />
                        </button>
                        <button onClick={() => setActiveTool('fill')} className={`p-2 rounded-md transition-all duration-200 transform hover:scale-110 ${activeTool === 'fill' ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-gray-700 hover:bg-gray-600'}`} title="Fill Tool">
                            <FillIcon className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={handleAutoMask}
                            disabled={isMasking || isLoading}
                            className="p-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-all duration-200 transform hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100"
                            title="Auto-mask background"
                        >
                            {isMasking ? <Spinner /> : <AutoMaskIcon className="w-5 h-5" />}
                        </button>
                    </div>
                    <div className="flex items-center gap-4 flex-grow sm:flex-grow-0">
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <span>Size:</span>
                            <input
                                type="range"
                                min="5"
                                max="100"
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="w-24 accent-purple-500"
                                disabled={activeTool !== 'brush' && activeTool !== 'eraser'}
                            />
                        </div>
                         <div className="flex items-center gap-2 text-sm text-gray-400">
                            <span>Opacity:</span>
                            <input
                                type="range"
                                min="0.1"
                                max="1"
                                step="0.1"
                                value={brushOpacity}
                                onChange={(e) => setBrushOpacity(Number(e.target.value))}
                                className="w-24 accent-purple-500"
                            />
                        </div>
                    </div>
                    <button onClick={clearDrawing} className="p-2 rounded-md bg-gray-700 hover:bg-gray-600 transition-all duration-200 transform hover:scale-110" title="Clear Mask">
                        <ResetIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

             <div className="w-full flex flex-col gap-4">
                <h2 className="text-xl font-semibold text-gray-300">2. Describe Your Edit</h2>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="e.g., 'Change the shirt to a vibrant red color' or 'Add a pair of sunglasses'"
                    className="w-full h-28 p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors"
                    disabled={isLoading}
                />
                 <div>
                    <label htmlFor="style-select" className="block text-sm font-medium text-gray-400 mb-1">Style</label>
                    <select 
                        id="style-select"
                        value={style}
                        onChange={(e) => setStyle(e.target.value)}
                        className="w-full p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors"
                        disabled={isLoading}
                    >
                        <option>Default</option>
                        <option>Photorealistic</option>
                        <option>Cartoon</option>
                        <option>Anime</option>
                        <option>Pixel Art</option>
                        <option>Watercolor</option>
                        <option>Impressionism</option>
                        <option>Pop Art</option>
                        <option>Surrealism</option>
                        <option>Minimalist</option>
                        <option>Fantasy</option>
                        <option>Cyberpunk</option>
                        <option>Steampunk</option>
                        <option>Art Deco</option>
                    </select>
                </div>

                <div>
                    <label htmlFor="negative-prompt" className="block text-sm font-medium text-gray-400 mb-1">Negative Prompt <span className="text-gray-500">(what to avoid)</span></label>
                    <textarea
                        id="negative-prompt"
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        placeholder="e.g., 'blurry, text, watermark, extra fingers'"
                        className="w-full h-20 p-3 bg-gray-700 rounded-lg border border-gray-600 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-colors"
                        disabled={isLoading}
                    />
                </div>

                 <button 
                    onClick={handleSubmit} 
                    disabled={isLoading || !prompt.trim()} 
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-3 px-4 rounded-lg shadow-lg shadow-purple-500/30 hover:shadow-xl hover:shadow-pink-500/40 disabled:bg-none disabled:bg-gray-600 disabled:shadow-none disabled:opacity-70 disabled:cursor-not-allowed transition-all transform hover:scale-105 duration-300 flex items-center justify-center"
                >
                    {isLoading ? <Spinner /> : 'Generate Image'}
                </button>
                {error && <p className="text-red-400 text-center">{error}</p>}
                
                <h2 className="text-xl font-semibold text-gray-300 mt-4">3. Result</h2>
                <div className="w-full aspect-auto rounded-lg bg-gray-900/50 border border-gray-700 flex items-center justify-center min-h-[200px] p-2">
                    {(isLoading || isUpscaling) && <Spinner large={true} />}
                    {!isLoading && !isUpscaling && (
                        upscaledImage ? (
                            <img src={upscaledImage} alt="Upscaled result" className="max-w-full max-h-full object-contain rounded-md" />
                        ) : editedImage ? (
                             <img src={editedImage} alt="Edited result" className="max-w-full max-h-full object-contain rounded-md" />
                        ) : (
                           <p className="text-gray-500">Your edited image will appear here</p>
                        )
                    )}
                </div>
                
                {editedImage && !isLoading && (
                    <div className="w-full flex flex-col gap-4 mt-2">
                         <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-4 p-3 bg-gray-900/50 rounded-lg">
                            <div className="flex items-center gap-2 text-gray-300">
                                <label htmlFor="upscale-factor">Upscale:</label>
                                <select
                                    id="upscale-factor"
                                    value={upscaleFactor}
                                    onChange={(e) => setUpscaleFactor(Number(e.target.value))}
                                    className="bg-gray-700 rounded-md border border-gray-600 p-2 text-sm focus:ring-2 focus:ring-blue-500"
                                    disabled={isUpscaling}
                                >
                                    <option value={2}>2x</option>
                                    <option value={4}>4x</option>
                                </select>
                            </div>
                            <button
                                onClick={handleUpscale}
                                disabled={isUpscaling}
                                className="w-full sm:w-auto flex-grow bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-70 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
                            >
                                {isUpscaling ? <Spinner /> : <><ExpandIcon className="w-5 h-5" /><span>Upscale Image</span></>}
                            </button>
                        </div>
                        
                        {!isUpscaling && (
                             <a 
                                href={upscaledImage || editedImage} 
                                download={`edited-image-${upscaledImage ? `${upscaleFactor}x-upscaled` : 'final'}.png`}
                                className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                             >
                                <DownloadIcon className="w-5 h-5" />
                                Download {upscaledImage ? 'Upscaled' : ''} Image
                            </a>
                        )}
                    </div>
                )}
            </div>
        </div>
        <div className="mt-8 flex justify-start">
            <button onClick={onReset} className="bg-gray-700 text-gray-300 py-2 px-4 rounded-lg hover:bg-gray-600 border border-gray-600 hover:border-gray-500 transition-all flex items-center gap-2">
                <BackIcon className="w-5 h-5" />
                Start Over
            </button>
        </div>
    </div>
  );
};

export default ImageEditor;