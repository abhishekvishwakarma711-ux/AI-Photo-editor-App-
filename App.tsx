
import React, { useState } from 'react';
import ImageUploader from './components/ImageUploader';
import ImageEditor from './components/ImageEditor';
import { GithubIcon, LogoIcon } from './components/Icons';

const App: React.FC = () => {
  const [originalImage, setOriginalImage] = useState<File | null>(null);

  const handleImageUpload = (file: File) => {
    setOriginalImage(file);
  };

  const handleReset = () => {
    setOriginalImage(null);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <header className="w-full max-w-6xl flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
            <LogoIcon className="w-10 h-10 text-purple-400" />
            <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                AI Image Editor
                </h1>
                <p className="text-sm text-gray-400">Powered by Gemini</p>
            </div>
        </div>
        <a href="https://github.com/google/gemini-api" target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-white transition-colors duration-300">
            <GithubIcon className="w-8 h-8" />
        </a>
      </header>

      <main className="w-full max-w-6xl flex-grow">
        <div className="bg-gray-800/50 p-4 sm:p-6 rounded-2xl shadow-2xl backdrop-blur-sm border border-gray-700">
          {!originalImage ? (
            <ImageUploader onImageUpload={handleImageUpload} />
          ) : (
            <ImageEditor originalImage={originalImage} onReset={handleReset} />
          )}
        </div>
      </main>

       <footer className="w-full max-w-6xl text-center text-gray-500 text-sm mt-8">
            <p>&copy; {new Date().getFullYear()} AI Image Editor. 
                Built with <a href="https://react.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">React</a> &amp; <a href="https://ai.google.dev" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-400">Gemini API</a>.
            </p>
        </footer>
    </div>
  );
};

export default App;
