import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const editImageWithMask = async (
  prompt: string,
  negativePrompt: string,
  style: string,
  originalImageBase64: string,
  originalMimeType: string,
  maskImageBase64: string
): Promise<string> => {
  try {
    let augmentedPrompt = `
      You are an expert image editor.
      Using the provided mask (second image), edit the original image (first image) based on the following instruction.
      Only modify the areas that are white in the mask. The black areas of the mask must remain untouched in the original image.
      Instruction: "${prompt}"
    `;

    if (style !== 'Default') {
        augmentedPrompt += ` in a ${style.toLowerCase()} style.`;
    }

    if (negativePrompt.trim()) {
        augmentedPrompt += `\nAvoid the following elements and styles: ${negativePrompt}.`;
    }


    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // aka Nano Banana
        contents: {
          parts: [
            {
              text: augmentedPrompt,
            },
            {
              inlineData: {
                data: originalImageBase64,
                mimeType: originalMimeType,
              },
            },
            {
              inlineData: {
                data: maskImageBase64,
                mimeType: 'image/png',
              },
            },
          ],
        },
        config: {
            responseModalities: [Modality.IMAGE],
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          return part.inlineData.data;
        }
      }
      
    throw new Error("No image data found in the API response.");

  } catch (error) {
    console.error("Error editing image with Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to edit image: ${error.message}`);
    }
    throw new Error("An unknown error occurred while editing the image.");
  }
};

export const generateBackgroundMask = async (
  imageBase64: string,
  mimeType: string
): Promise<string> => {
  try {
    const prompt = `
      You are an expert in image segmentation.
      Analyze the provided image and identify the main subject(s).
      Your task is to create a binary mask image.
      In the mask, the background should be pure white (#FFFFFF) and the main subject(s) should be pure black (#000000).
      Do not include any shades of gray or other colors. The output must be a clean, black and white mask.
      The mask must have the exact same dimensions as the original image.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt,
          },
          {
            inlineData: {
              data: imageBase64,
              mimeType: mimeType,
            },
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return part.inlineData.data;
      }
    }

    throw new Error("No mask data found in the API response.");
  } catch (error) {
    console.error("Error generating background mask with Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to generate mask: ${error.message}`);
    }
    throw new Error("An unknown error occurred while generating the mask.");
  }
};


export const upscaleImage = async (
  imageBase64: string,
  factor: number
): Promise<string> => {
  try {
    const prompt = `
      You are an expert in image processing.
      Upscale the following image to ${factor}x its original resolution.
      It is crucial that you enhance the details and clarity without adding, removing, or changing any content or subjects in the image.
      Preserve the original art style, colors, and composition perfectly.
      The output image must be a high-quality, upscaled version of the input.
    `;

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: prompt,
          },
          {
            inlineData: {
              data: imageBase64,
              mimeType: 'image/png', // The edited image is a PNG data URL
            },
          },
        ],
      },
      config: {
        responseModalities: [Modality.IMAGE],
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return part.inlineData.data;
      }
    }

    throw new Error("No upscaled image data found in the API response.");
  } catch (error) {
    console.error("Error upscaling image with Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to upscale image: ${error.message}`);
    }
    throw new Error("An unknown error occurred while upscaling the image.");
  }
};