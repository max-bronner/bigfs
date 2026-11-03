// The page's fixed elements, looked up once; the script loads after the body

/** Canvas the terrain and its layers are drawn on */
export const canvas = document.getElementById('terrain') as HTMLCanvasElement;
/** 2D context of the terrain canvas */
export const context = canvas.getContext('2d')!;
/** Left panel: the map's facts, dictionaries, scripts and areas */
export const info = document.getElementById('info')!;
/** Right panel's list of placed objects */
export const objectList = document.getElementById('objects')!;
/** Panel under the object list showing the selected object */
export const objectDetails = document.getElementById('object')!;
