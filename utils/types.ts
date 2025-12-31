export type Tool = "pen" | "highlighter" | "rectangle" | "circle" | "arrow" | "text" | "move" | "eraser" | null;

export type Color = "white" | "red" | "yellow" | "blue";

export type ShapeMode = "outline" | "filled";

export type PenWidth = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface DrawingState {
  tool: Tool;
  color: Color;
  shapeMode: ShapeMode;
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface Point {
  x: number;
  y: number;
}

