import type { Tool, Color, ShapeMode, Point, PenWidth } from "./types";

export function drawShape(
  ctx: CanvasRenderingContext2D,
  tool: Tool,
  start: Point,
  end: Point,
  color: Color,
  mode: ShapeMode,
  penWidth: PenWidth = 3
) {
  if (!tool || tool === "pen") return;

  ctx.strokeStyle = getColorValue(color);
  ctx.fillStyle = getColorValue(color);
  ctx.lineWidth = penWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (mode === "filled") {
    ctx.globalAlpha = 0.35;
  } else {
    ctx.globalAlpha = 1;
  }

  const width = end.x - start.x;
  const height = end.y - start.y;

  switch (tool) {
    case "rectangle":
      if (mode === "filled") {
        ctx.fillRect(start.x, start.y, width, height);
      } else {
        ctx.strokeRect(start.x, start.y, width, height);
      }
      break;

    case "circle": {
      const centerX = start.x + width / 2;
      const centerY = start.y + height / 2;
      const radiusX = Math.abs(width) / 2;
      const radiusY = Math.abs(height) / 2;
      const radius = Math.max(radiusX, radiusY);

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radius, radius, 0, 0, 2 * Math.PI);
      if (mode === "filled") {
        ctx.fill();
      } else {
        ctx.stroke();
      }
      break;
    }

    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);

      // Arrowhead
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const arrowLength = 15;
      const arrowAngle = Math.PI / 6;

      ctx.lineTo(
        end.x - arrowLength * Math.cos(angle - arrowAngle),
        end.y - arrowLength * Math.sin(angle - arrowAngle)
      );
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - arrowLength * Math.cos(angle + arrowAngle),
        end.y - arrowLength * Math.sin(angle + arrowAngle)
      );

      ctx.stroke();
      break;
    }
  }

  ctx.globalAlpha = 1;
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: Color,
  penWidth: PenWidth = 3
) {
  ctx.strokeStyle = getColorValue(color);
  ctx.lineWidth = penWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

export function drawHighlighter(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  color: Color,
  penWidth: PenWidth = 3
) {
  ctx.strokeStyle = getHighlighterColorValue(color); // Use neon colors for highlighter
  ctx.lineWidth = penWidth * 2; // Highlighter is thicker
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.4; // Semi-transparent like a real highlighter

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.globalAlpha = 1; // Reset alpha
}

// Draw a continuous highlighter path (for smooth highlighting)
export function drawHighlighterPath(
  ctx: CanvasRenderingContext2D,
  path: Array<Point>,
  color: Color,
  penWidth: PenWidth = 3
) {
  if (path.length < 2) return;
  
  ctx.strokeStyle = getHighlighterColorValue(color); // Use neon colors for highlighter
  ctx.lineWidth = penWidth * 2; // Highlighter is thicker
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.4; // Semi-transparent like a real highlighter

  // Draw the entire path as a continuous stroke
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  
  ctx.stroke();
  ctx.globalAlpha = 1; // Reset alpha
}

export function clearCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

export function getColorValue(color: Color): string {
  const colors = {
    white: "#ffffff",
    red: "#ff3b30",
    yellow: "#ffcc00",
    blue: "#007aff",
  };
  return colors[color];
}

export function getHighlighterColorValue(color: Color): string {
  // Neon/bright highlighter colors like real highlighters
  const neonColors = {
    white: "#FFFF00",    // Bright yellow (most common highlighter)
    red: "#FF69B4",      // Hot pink
    yellow: "#FFEB3B",   // Bright neon yellow
    blue: "#00FFFF",     // Bright cyan
  };
  return neonColors[color];
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: Color,
  fontSize: number = 16
) {
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = "top";
  
  // Measure text to create background
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize;
  const padding = 4;
  
  // Draw background with slight transparency for visibility
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(
    x - padding,
    y - padding,
    textWidth + padding * 2,
    textHeight + padding * 2
  );
  
  // Draw white border with 10% opacity
  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    x - padding,
    y - padding,
    textWidth + padding * 2,
    textHeight + padding * 2
  );
  
  // Draw text
  ctx.fillStyle = getColorValue(color);
  ctx.fillText(text, x, y);
}

