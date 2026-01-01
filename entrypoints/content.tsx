import { defineContentScript } from "wxt/sandbox";
import { drawShape, drawLine, getColorValue } from "../utils/canvas";
import type { Tool, Color, ShapeMode } from "../utils/types";

// Annotation data structure - uses document coordinates
interface Annotation {
  type: "pen" | "rectangle" | "circle" | "arrow";
  start: { x: number; y: number };
  end?: { x: number; y: number };
  path?: Array<{ x: number; y: number }>;
  color: Color;
  shapeMode?: ShapeMode;
}

interface TextAnnotation {
  id: string;
  x: number; // Document coordinates
  y: number; // Document coordinates
  text: string;
  color: Color;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    let isActive = false;

    // State
    let activeTool: Tool = null;
    let selectedColor: Color = "red";
    let shapeMode: ShapeMode = "outline";
    let lastUsedShape: "rectangle" | "circle" | "arrow" = "rectangle";
    let isDrawing = false;
    let startPoint: { x: number; y: number } | null = null;
    let currentPath: Array<{ x: number; y: number }> = [];
    let mouse = { x: 0, y: 0 };
    
    // Annotations stored in document coordinates
    const annotations: Annotation[] = [];
    const textAnnotations: TextAnnotation[] = [];
    
    // Dragging state
    let draggingAnnotation: number | null = null;
    let draggingText: { id: string; offsetX: number; offsetY: number } | null = null;

    // Create overlay container - PRESERVE EXISTING STRUCTURE
    const overlay = document.createElement("div");
    overlay.id = "annoted-overlay";
    overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
    pointer-events: none;
      margin: 0;
      padding: 0;
      border: 0;
    `;
    document.body.appendChild(overlay);

    // Create canvas - VIEWPORT SIZED (annotations stored in document coordinates)
    const createCanvas = () => {
      if (canvas) {
        canvas.remove();
      }

      canvas = document.createElement("canvas");
      canvas.id = "canvas-draw";
      // Canvas is viewport-sized for event capture
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
      // Canvas is fixed to viewport - annotations scroll via coordinate conversion
      canvas.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: transparent;
        pointer-events: none;
        margin: 0;
        padding: 0;
        border: 0;
      `;
      overlay.appendChild(canvas);

  ctx = canvas.getContext("2d");
  if (!ctx) return;

      // Redraw on scroll so annotations appear to scroll with page
      const handleScroll = () => {
      redrawAll();
      };
      window.addEventListener("scroll", handleScroll, { passive: true });
    };

    // Redraw all annotations - convert document coordinates to viewport coordinates
    const redrawAll = () => {
      if (!canvas || !ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Convert document coordinates to viewport coordinates
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      annotations.forEach((ann) => {
        if (ann.type === "pen" && ann.path) {
          ctx!.strokeStyle = getColorValue(ann.color);
          ctx!.lineWidth = 3;
          ctx!.lineJoin = "round";
          ctx!.lineCap = "round";
          ctx!.beginPath();
          // Convert document coords to viewport coords
          const firstPoint = ann.path[0];
          const viewportX = firstPoint.x - scrollX;
          const viewportY = firstPoint.y - scrollY;
          if (viewportY >= -50 && viewportY <= window.innerHeight + 50) {
            ctx!.moveTo(viewportX, viewportY);
            for (let i = 1; i < ann.path.length; i++) {
              const p = ann.path[i];
              const vx = p.x - scrollX;
              const vy = p.y - scrollY;
              if (vy >= -50 && vy <= window.innerHeight + 50) {
                ctx!.lineTo(vx, vy);
              }
            }
            ctx!.stroke();
          }
        } else if (ann.end) {
          // Shapes - convert to viewport coordinates
          const start = { x: ann.start.x - scrollX, y: ann.start.y - scrollY };
          const end = { x: ann.end.x - scrollX, y: ann.end.y - scrollY };
          // Only draw if visible in viewport
          if (
            (start.y >= -100 && start.y <= window.innerHeight + 100) ||
            (end.y >= -100 && end.y <= window.innerHeight + 100)
          ) {
            drawShape(ctx!, ann.type, start, end, ann.color, ann.shapeMode || "outline", 3);
          }
        }
      });
    };

    // Update text annotations DOM - convert document coords to viewport
    const updateTextAnnotations = () => {
      // Remove old text elements
      const oldTexts = overlay.querySelectorAll(".annoted-text");
      oldTexts.forEach((el) => el.remove());

      // Add text annotations - use fixed positioning, convert document to viewport
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      
      textAnnotations.forEach((text) => {
        // Only show if in viewport
        const viewportY = text.y - scrollY;
        if (viewportY < -100 || viewportY > window.innerHeight + 100) {
          return;
        }
        
        const div = document.createElement("div");
        div.id = text.id;
        div.className = "annoted-text";
        div.style.cssText = `
          position: fixed;
          left: ${text.x - scrollX}px;
          top: ${viewportY}px;
          pointer-events: auto;
          z-index: 2147483648;
          margin: 0;
          padding: 0;
        `;
        const input = document.createElement("input");
        input.type = "text";
        input.value = text.text;
        input.placeholder = "Type text...";
        input.style.cssText = `
          padding: 8px;
          border: 2px solid ${getColorValue(text.color)};
          background: white;
          min-width: 200px;
          font-size: 14px;
        `;
        input.oninput = (e) => {
          text.text = (e.target as HTMLInputElement).value;
        };
        input.onblur = () => {
          if (!text.text.trim()) {
            const index = textAnnotations.findIndex((t) => t.id === text.id);
            if (index > -1) {
              textAnnotations.splice(index, 1);
              updateTextAnnotations();
            }
          }
        };
        div.appendChild(input);
        overlay.appendChild(div);
      });
    };

    // Icon SVG helper - Lucide-style icons
    const createIcon = (name: string): string => {
      const icons: Record<string, string> = {
        pencil: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>`,
        move: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
        square: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>`,
        stickynote: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></svg>`,
        palette: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`,
        camera: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>`,
        download: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
      };
      return icons[name] || "";
    };

    // Close any open dropdowns
    const closeDropdowns = () => {
      const dropdowns = overlay.querySelectorAll(".annoted-dropdown");
      dropdowns.forEach((d) => d.remove());
    };

    // Create dropdown menu
    const createDropdown = (x: number, y: number, items: Array<{ label: string; onClick: () => void }>) => {
      closeDropdowns();
      const dropdown = document.createElement("div");
      dropdown.className = "annoted-dropdown";
      dropdown.style.cssText = `
        position: fixed;
        left: ${x}px;
        top: ${y}px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 4px;
        z-index: 2147483649;
        pointer-events: auto;
        min-width: 120px;
      `;

      items.forEach((item) => {
        if (item.label.startsWith("─")) {
          // Separator
          const sep = document.createElement("div");
          sep.textContent = item.label;
          sep.style.cssText = `
            width: 100%;
            padding: 4px 12px;
            text-align: center;
            color: #ccc;
            font-size: 12px;
            pointer-events: none;
          `;
          dropdown.appendChild(sep);
        } else {
          const btn = document.createElement("button");
          btn.textContent = item.label;
          btn.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: white;
            text-align: left;
            cursor: pointer;
            font-size: 14px;
            border-radius: 4px;
          `;
          btn.onmouseenter = () => {
            btn.style.background = "#f5f5f5";
          };
          btn.onmouseleave = () => {
            btn.style.background = "white";
          };
          btn.onclick = () => {
            item.onClick();
            closeDropdowns();
          };
          dropdown.appendChild(btn);
        }
      });

      overlay.appendChild(dropdown);

      // Close on outside click
      setTimeout(() => {
        const closeOnClick = (e: MouseEvent) => {
          if (!dropdown.contains(e.target as Node)) {
            closeDropdowns();
            document.removeEventListener("click", closeOnClick);
          }
        };
        setTimeout(() => document.addEventListener("click", closeOnClick), 0);
      }, 0);
    };

    // Vertical toolbar with icons
    const createToolbar = () => {
      const toolbar = document.createElement("div");
      toolbar.id = "annoted-toolbar";
      toolbar.style.cssText = `
        position: fixed;
        top: 50%;
        right: 16px;
        transform: translateY(-50%);
        z-index: 2147483648;
        background: white;
        padding: 8px;
        border-radius: 12px;
        box-shadow: 0 2px 12px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        gap: 4px;
        pointer-events: auto;
        font-family: Arial, sans-serif;
      `;

      // Helper to create icon button
      const createIconButton = (iconName: string, isActive: boolean, onClick: () => void, onRightClick?: () => void) => {
        const btn = document.createElement("button");
        btn.innerHTML = createIcon(iconName);
        btn.style.cssText = `
          width: 40px;
          height: 40px;
          padding: 0;
          border: ${isActive ? "2px solid #000" : "1px solid #e0e0e0"};
          background: ${isActive ? "#f0f0f0" : "white"};
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${isActive ? "#000" : "#666"};
        `;
        btn.onclick = (e) => {
          e.preventDefault();
          onClick();
        };
        if (onRightClick) {
          btn.oncontextmenu = (e) => {
            e.preventDefault();
            const rect = btn.getBoundingClientRect();
            onRightClick();
          };
        }
        return btn;
      };

      // Pen tool
      toolbar.appendChild(
        createIconButton("pencil", activeTool === "pen", () => {
          activeTool = activeTool === "pen" ? null : "pen";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          updateToolbar();
        })
      );

      // Move tool
      toolbar.appendChild(
        createIconButton("move", activeTool === "move", () => {
          activeTool = activeTool === "move" ? null : "move";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          updateToolbar();
        })
      );

      // Shapes tool (grouped)
      const isShapeActive = activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow";
      toolbar.appendChild(
        createIconButton(
          "square",
          isShapeActive,
          () => {
            // Left click: toggle last used shape
            if (isShapeActive) {
              activeTool = null;
              if (canvas) {
                canvas.style.pointerEvents = "none";
              }
            } else {
              activeTool = lastUsedShape;
              if (canvas) {
                canvas.style.pointerEvents = "auto";
              }
            }
            updateToolbar();
          },
          () => {
            // Right click: show shape dropdown
            const btn = toolbar.querySelector('button:nth-child(3)') as HTMLElement;
            const rect = btn.getBoundingClientRect();
            createDropdown(rect.left - 130, rect.top, [
              {
                label: "Rectangle",
                onClick: () => {
                  lastUsedShape = "rectangle";
                  activeTool = "rectangle";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  updateToolbar();
                },
              },
              {
                label: "Circle",
                onClick: () => {
                  lastUsedShape = "circle";
                  activeTool = "circle";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  updateToolbar();
                },
              },
              {
                label: "Arrow",
                onClick: () => {
                  lastUsedShape = "arrow";
                  activeTool = "arrow";
                  if (canvas) canvas.style.pointerEvents = "auto";
                  updateToolbar();
                },
              },
              { label: "────────", onClick: () => { closeDropdowns(); } },
              {
                label: shapeMode === "outline" ? "✓ Outline" : "Outline",
                onClick: () => {
                  shapeMode = "outline";
                  updateToolbar();
                },
              },
              {
                label: shapeMode === "filled" ? "✓ Filled" : "Filled",
                onClick: () => {
                  shapeMode = "filled";
                  updateToolbar();
                },
              },
            ]);
          }
        )
      );

      // Text tool
      toolbar.appendChild(
        createIconButton("stickynote", activeTool === "text", () => {
          activeTool = activeTool === "text" ? null : "text";
          if (canvas) {
            canvas.style.pointerEvents = activeTool ? "auto" : "none";
          }
          updateToolbar();
        })
      );

      // Color picker
      const colorBtn = createIconButton("palette", false, () => {
        // Left click: cycle color
        const colors: Color[] = ["red", "blue", "yellow", "white"];
        const currentIndex = colors.indexOf(selectedColor);
        selectedColor = colors[(currentIndex + 1) % colors.length];
        updateToolbar();
      });
      // Color indicator
      const colorIndicator = document.createElement("div");
      colorIndicator.style.cssText = `
        position: absolute;
        bottom: 2px;
        right: 2px;
        width: 12px;
        height: 12px;
        background: ${getColorValue(selectedColor)};
        border-radius: 2px;
        border: 1px solid #fff;
        box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
      `;
      colorBtn.style.position = "relative";
      colorBtn.appendChild(colorIndicator);
      colorBtn.oncontextmenu = (e) => {
        e.preventDefault();
        const rect = colorBtn.getBoundingClientRect();
        const colors: Color[] = ["red", "blue", "yellow", "white"];
        const colorLabels: Record<Color, string> = { 
          red: "Red", 
          blue: "Blue", 
          yellow: "Yellow", 
          white: "Black"
        };
        createDropdown(rect.left - 130, rect.top, colors.map((color) => ({
          label: selectedColor === color ? `✓ ${colorLabels[color]}` : colorLabels[color],
          onClick: () => {
            selectedColor = color;
            updateToolbar();
          },
        })));
      };
      toolbar.appendChild(colorBtn);

      overlay.appendChild(toolbar);
    };

    const updateToolbar = () => {
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) {
        toolbar.remove();
      }
      createToolbar();
    };

    // Mouse handlers - USE DOCUMENT COORDINATES (pageX/pageY)
    const handleMouseDown = (e: MouseEvent) => {
      if (!activeTool || !canvas || !ctx) return;
      if ((e.target as HTMLElement).closest("#annoted-toolbar")) return;

      // Use pageX/pageY for document coordinates
      const x = e.pageX;
      const y = e.pageY;

      if (activeTool === "text") {
        const id = `text-${Date.now()}`;
        textAnnotations.push({ id, x, y, text: "", color: selectedColor });
        updateTextAnnotations();
        const input = document.getElementById(id) as HTMLInputElement;
        if (input) {
          input.focus();
        }
        return;
      }

      if (activeTool === "move") {
        // Check text annotations
        for (let i = textAnnotations.length - 1; i >= 0; i--) {
          const text = textAnnotations[i];
          const el = document.getElementById(text.id);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (
              e.clientX >= rect.left &&
              e.clientX <= rect.right &&
              e.clientY >= rect.top &&
              e.clientY <= rect.bottom
            ) {
              draggingText = {
                id: text.id,
                offsetX: e.clientX - rect.left,
                offsetY: e.clientY - rect.top,
              };
              return;
            }
          }
        }
        // Check canvas annotations (simplified hit test - check last few)
        for (let i = annotations.length - 1; i >= Math.max(0, annotations.length - 5); i--) {
          const ann = annotations[i];
          if (ann.end) {
            const minX = Math.min(ann.start.x, ann.end.x);
            const maxX = Math.max(ann.start.x, ann.end.x);
            const minY = Math.min(ann.start.y, ann.end.y);
            const maxY = Math.max(ann.start.y, ann.end.y);
            if (x >= minX - 10 && x <= maxX + 10 && y >= minY - 10 && y <= maxY + 10) {
              draggingAnnotation = i;
              return;
            }
          } else if (ann.path && ann.path.length > 0) {
            // Check if near pen path
            for (const point of ann.path) {
              const dist = Math.sqrt(Math.pow(x - point.x, 2) + Math.pow(y - point.y, 2));
              if (dist < 20) {
                draggingAnnotation = i;
                return;
              }
            }
          }
        }
        return;
      }

      // Start drawing
      isDrawing = true;
      startPoint = { x, y };

      if (activeTool === "pen") {
        currentPath = [{ x, y }];
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvas || !ctx) return;

      const x = e.pageX;
      const y = e.pageY;
      
      // Update mouse for handleMouseUp
      mouse = { x, y };

      if (draggingText) {
        const text = textAnnotations.find((t) => t.id === draggingText!.id);
        if (text) {
          text.x = x - draggingText.offsetX;
          text.y = y - draggingText.offsetY;
          updateTextAnnotations();
        }
        return;
      }

      if (draggingAnnotation !== null) {
        const ann = annotations[draggingAnnotation];
        const dx = x - (ann.end ? ann.end.x : ann.start.x);
        const dy = y - (ann.end ? ann.end.y : ann.start.y);
        
        ann.start.x += dx;
        ann.start.y += dy;
        if (ann.end) {
          ann.end.x += dx;
          ann.end.y += dy;
        }
        if (ann.path) {
          ann.path.forEach((p) => {
            p.x += dx;
            p.y += dy;
          });
        }
        redrawAll();
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      if (activeTool === "pen") {
        currentPath.push({ x, y });
        redrawAll();
        // Draw current path in viewport coordinates
        if (ctx) {
          ctx.strokeStyle = getColorValue(selectedColor);
          ctx.lineWidth = 3;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          const firstPoint = currentPath[0];
          ctx.moveTo(firstPoint.x - scrollX, firstPoint.y - scrollY);
          for (let i = 1; i < currentPath.length; i++) {
            const p = currentPath[i];
            ctx.lineTo(p.x - scrollX, p.y - scrollY);
          }
          ctx.stroke();
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        // Preview shape in viewport coordinates
        redrawAll();
        if (ctx) {
          const scrollY = window.scrollY;
          const scrollX = window.scrollX;
          const start = { x: startPoint.x - scrollX, y: startPoint.y - scrollY };
          const end = { x: x - scrollX, y: y - scrollY };
          drawShape(ctx, activeTool, start, end, selectedColor, shapeMode, 3);
        }
      }
    };

    const handleMouseUp = () => {
      if (draggingText) {
        draggingText = null;
        return;
      }

      if (draggingAnnotation !== null) {
        draggingAnnotation = null;
        return;
      }

      if (!isDrawing || !activeTool || !startPoint) return;

      const x = mouse.x;
      const y = mouse.y;

      if (activeTool === "pen") {
        if (currentPath.length > 1) {
          annotations.push({
            type: "pen",
            start: currentPath[0],
            path: [...currentPath],
            color: selectedColor,
          });
        }
      } else if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
        annotations.push({
          type: activeTool,
          start: startPoint,
          end: { x, y },
          color: selectedColor,
          shapeMode,
        });
      }

      isDrawing = false;
      startPoint = null;
      currentPath = [];
      redrawAll();
    };

    // Activate annotation mode
    const activate = () => {
      if (isActive) return;
      isActive = true;

      createCanvas();
      createToolbar();

      if (!canvas || !ctx) return;

      // Enable pointer events
      overlay.style.pointerEvents = "auto";
      canvas.style.pointerEvents = "auto";

      // Track mouse for coordinates (document coordinates)
      canvas.addEventListener("mousemove", (e) => {
        mouse.x = e.pageX;
        mouse.y = e.pageY;
      }, false);

      // Attach mouse events
      canvas.addEventListener("mousedown", handleMouseDown);
      canvas.addEventListener("mousemove", handleMouseMove);
      canvas.addEventListener("mouseup", handleMouseUp);
      canvas.addEventListener("mouseleave", handleMouseUp);
      
      // Update text positions on scroll
      const handleTextScroll = () => {
        updateTextAnnotations();
      };
      window.addEventListener("scroll", handleTextScroll, { passive: true });
    };

    // Deactivate annotation mode
    const deactivate = () => {
      if (!isActive) return;
      isActive = false;

      if (canvas) {
        canvas.remove();
        canvas = null;
      }
      const toolbar = document.getElementById("annoted-toolbar");
      if (toolbar) toolbar.remove();
      const oldTexts = overlay.querySelectorAll(".annoted-text");
      oldTexts.forEach((el) => el.remove());

      overlay.style.pointerEvents = "none";
    };

    // Handle resize - canvas stays viewport-sized
    const handleResize = () => {
      if (!isActive || !canvas || !ctx) return;

      // Canvas is viewport-sized, just update dimensions
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      ctx.putImageData(imageData, 0, 0);
      redrawAll();
    };

    window.addEventListener("resize", handleResize);

    // Keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        activeTool = activeTool === "pen" ? null : "pen";
        if (canvas) {
          canvas.style.pointerEvents = activeTool ? "auto" : "none";
        }
        updateToolbar();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        activeTool = activeTool === "move" ? null : "move";
        if (canvas) {
          canvas.style.pointerEvents = activeTool ? "auto" : "none";
        }
        updateToolbar();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    // Listen for activation message
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "toggle") {
        if (isActive) {
          deactivate();
    } else {
          activate();
        }
        sendResponse({ active: isActive });
      }
      return true;
    });
  },
});
