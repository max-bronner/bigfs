/** The page's fixed elements, looked up once; the script loads after the body */
export const canvas = document.getElementById('terrain') as HTMLCanvasElement;
export const context = canvas.getContext('2d')!;
export const info = document.getElementById('info')!;
export const objectList = document.getElementById('objects')!;
export const objectDetails = document.getElementById('object')!;
