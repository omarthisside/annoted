import React from "react";
import type { Tool, Color, ShapeMode, PenWidth } from "../utils/types";
import { getColorValue } from "../utils/canvas";
import { 
  Pen, 
  Type,
  Move, 
  Square, 
  Circle, 
  ArrowRight, 
  Camera, 
  Undo, 
  Redo, 
  Trash2, 
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter
} from "lucide-react";

interface ToolbarProps {
  activeTool: Tool;
  selectedColor: Color;
  shapeMode: ShapeMode;
  penWidth: PenWidth;
  onToolSelect: (tool: Tool) => void;
  onColorSelect: (color: Color) => void;
  onShapeModeToggle: () => void;
  onPenWidthChange: (width: PenWidth) => void;
  onScreenshot: () => void;
  onDownload: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function Toolbar({
  activeTool,
  selectedColor,
  shapeMode,
  penWidth,
  onToolSelect,
  onColorSelect,
  onShapeModeToggle,
  onPenWidthChange,
  onScreenshot,
  onDownload,
  onUndo,
  onRedo,
  onClearAll,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const [showShapeMenu, setShowShapeMenu] = React.useState(false);
  const [showPenWidthMenu, setShowPenWidthMenu] = React.useState(false);
  const [lastSelectedShape, setLastSelectedShape] = React.useState<Tool>("rectangle");
  const [isHovered, setIsHovered] = React.useState(false);
  const hideTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Update last selected shape when a shape tool is selected
  React.useEffect(() => {
    if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") {
      setLastSelectedShape(activeTool);
    }
  }, [activeTool]);

  const colors: Color[] = ["white", "red", "yellow", "blue"];
  const penWidths: PenWidth[] = [2, 4, 6, 8, 10];
  const [customColor, setCustomColor] = React.useState("#ffffff");

  const handleMouseEnter = () => {
    // Clear any existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    // Set timeout to hide after 10 seconds
    hideTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      hideTimeoutRef.current = null;
    }, 10000); // 10 seconds
  };

  // Show toolbar initially for 10 seconds when component mounts
  React.useEffect(() => {
    setIsHovered(true);
    // Hide after 10 seconds
    hideTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      hideTimeoutRef.current = null;
    }, 10000);
    
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* Toolbar - right side, always visible when enabled */}
      <div
        className="proofly-toolbar"
        style={{
          position: "fixed",
          right: "24px",
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 1000000,
          background: "rgba(0, 0, 0, 0.2)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "16px",
          padding: "14px 10px",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          pointerEvents: "auto",
        }}
      >
      <div className="flex flex-col items-center gap-3">
        {/* Group 1: Tools */}
        {/* Move Tool */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
            onClick={() => {
              onToolSelect(activeTool === "move" ? null : "move");
              setShowShapeMenu(false);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
          className="p-2 transition-colors hover:bg-orange-500/20"
            style={{ cursor: activeTool === "move" ? "move" : "pointer" }}
            title="Move Tool - Drag annotations to reposition"
          >
            <Move size={20} color={activeTool === "move" ? "#ff6b35" : "white"} strokeWidth={2} />
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: activeTool === "move" ? "#ff6b35" : "white" }}>Move (M)</span>
        </div>

        {/* Pen Tool */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
        <button
          onClick={() => {
            onToolSelect(activeTool === "pen" ? null : "pen");
            setShowShapeMenu(false);
            setShowColorPicker(false);
              setShowPenWidthMenu(false);
          }}
          className="p-2 transition-colors hover:bg-orange-500/20"
          style={{ cursor: activeTool === "pen" ? "crosshair" : "pointer" }}
            title="Pen Tool - Draw freehand"
          >
            <Pen size={20} color={activeTool === "pen" ? "#ff6b35" : "white"} strokeWidth={2} />
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: activeTool === "pen" ? "#ff6b35" : "white" }}>Pen (P)</span>
        </div>

        {/* Highlighter Tool */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
            onClick={() => {
              onToolSelect(activeTool === "highlighter" ? null : "highlighter");
              setShowShapeMenu(false);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
            className="p-2 transition-colors hover:bg-orange-500/20"
            style={{ cursor: activeTool === "highlighter" ? "crosshair" : "pointer" }}
            title="Highlighter Tool - Draw semi-transparent highlights"
          >
            <Highlighter size={20} color={activeTool === "highlighter" ? "#ff6b35" : "white"} strokeWidth={2} />
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: activeTool === "highlighter" ? "#ff6b35" : "white" }}>Highlighter (H)</span>
        </div>

        {/* Shapes Tool */}
        <div className="flex flex-col items-center gap-1 relative">
          <button
            onClick={() => {
              // Use last selected shape or toggle off if already active
              if (activeTool === lastSelectedShape) {
                onToolSelect(null);
              } else {
                onToolSelect(lastSelectedShape);
              }
              setShowShapeMenu(false);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setShowShapeMenu(!showShapeMenu);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
            className="p-2 transition-colors hover:bg-orange-500/20"
            title="Shapes - Draw rectangles, circles, or arrows (Right-click for menu)"
          >
            {(() => {
              const shapeToShow = activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow" 
                ? activeTool 
                : lastSelectedShape;
              const isShapeActive = activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow";
              const iconColor = isShapeActive ? "#ff6b35" : "white";
              
              if (shapeToShow === "rectangle") {
                return <Square size={20} color={iconColor} strokeWidth={2} />;
              } else if (shapeToShow === "circle") {
                return <Circle size={20} color={iconColor} strokeWidth={2} />;
              } else {
                return <ArrowRight size={20} color={iconColor} strokeWidth={2} />;
              }
            })()}
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: (activeTool === "rectangle" || activeTool === "circle" || activeTool === "arrow") ? "#ff6b35" : "white" }}>Shape (S)</span>
          {showShapeMenu && (
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 rounded-lg"
              style={{
                background: "rgba(30, 30, 30, 0.95)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
              }}
            >
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => {
                    onToolSelect(activeTool === "rectangle" ? null : "rectangle");
                    setShowShapeMenu(false);
                  }}
                  className="p-2 rounded transition-colors hover:bg-orange-500/20"
                  title="Rectangle - Draw rectangular shapes"
                >
                  <Square size={20} color={activeTool === "rectangle" ? "#ff6b35" : "white"} strokeWidth={2} />
                </button>
                <button
                  onClick={() => {
                    onToolSelect(activeTool === "circle" ? null : "circle");
                    setLastSelectedShape("circle");
                    setShowShapeMenu(false);
                  }}
                  className="p-2 rounded transition-colors hover:bg-orange-500/20"
                  title="Circle - Draw circular shapes"
                >
                  <Circle size={20} color={activeTool === "circle" ? "#ff6b35" : "white"} strokeWidth={2} />
                </button>
                <button
                  onClick={() => {
                    onToolSelect(activeTool === "arrow" ? null : "arrow");
                    setLastSelectedShape("arrow");
                    setShowShapeMenu(false);
                  }}
                  className="p-2 rounded transition-colors hover:bg-orange-500/20"
                  title="Arrow - Draw arrow shapes"
                >
                  <ArrowRight size={20} color={activeTool === "arrow" ? "#ff6b35" : "white"} strokeWidth={2} />
                </button>
                {activeTool && activeTool !== "pen" && (
                  <button
                    onClick={() => {
                      onShapeModeToggle();
                      setShowShapeMenu(false);
                    }}
                    className="p-2 rounded transition-colors hover:bg-orange-500/20"
                    title={shapeMode === "outline" ? "Fill shape" : "Outline shape"}
                  >
                    {shapeMode === "outline" ? (
                      <Square size={20} color="white" strokeWidth={2} fill="none" />
                    ) : (
                      <Square size={20} color="white" strokeWidth={2} fill="white" />
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Text Tool */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
            onClick={() => {
              onToolSelect(activeTool === "text" ? null : "text");
              setShowShapeMenu(false);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
            className="p-2 transition-colors hover:bg-orange-500/20"
            style={{ cursor: activeTool === "text" ? "crosshair" : "pointer" }}
            title="Text Tool - Add text annotations"
          >
            <Type size={20} color={activeTool === "text" ? "#ff6b35" : "white"} strokeWidth={2} />
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: activeTool === "text" ? "#ff6b35" : "white" }}>Text (T)</span>
        </div>

        {/* Eraser Tool */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
            onClick={() => {
              onToolSelect(activeTool === "eraser" ? null : "eraser");
              setShowShapeMenu(false);
              setShowColorPicker(false);
              setShowPenWidthMenu(false);
            }}
            className="p-2 transition-colors hover:bg-orange-500/20"
            style={{ cursor: activeTool === "eraser" ? "pointer" : "pointer" }}
            title="Eraser Tool - Click to delete annotations"
          >
            <Eraser size={20} color={activeTool === "eraser" ? "#ff6b35" : "white"} strokeWidth={2} />
          </button>
          <span className="font-medium" style={{ fontSize: "9px", color: activeTool === "eraser" ? "#ff6b35" : "white" }}>Eraser (E)</span>
        </div>

        {/* Pen Width Selector */}
        <div className="flex flex-col items-center gap-1 relative">
          <button
            onClick={() => {
              setShowPenWidthMenu(!showPenWidthMenu);
              setShowColorPicker(false);
              setShowShapeMenu(false);
            }}
            className="p-2 hover:bg-orange-500/20 transition-colors"
            style={{
              backgroundColor: showPenWidthMenu ? "rgba(255, 255, 255, 0.2)" : "transparent",
            }}
            title={`Pen Width - Current: ${penWidth}px`}
          >
            <div className="flex items-center justify-center w-5 h-5">
              <div
                className="bg-white rounded"
                style={{
                  width: `${penWidth}px`,
                  height: `${penWidth}px`,
                }}
              />
            </div>
          </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Width</span>
          {showPenWidthMenu && (
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 rounded-lg"
              style={{
                background: "rgba(30, 30, 30, 0.95)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                padding: "12px",
              }}
            >
              <div className="flex flex-col items-center gap-3">
                {penWidths.map((width) => (
                  <button
                    key={width}
                    onClick={() => {
                      onPenWidthChange(width);
                      setShowPenWidthMenu(false);
                    }}
                    className={`w-12 h-12 rounded transition-colors flex items-center justify-center ${
                      penWidth === width
                        ? "bg-orange-500/30 border-2 border-orange-500"
                        : "hover:bg-orange-500/20 border-2 border-transparent"
                    }`}
                    title={`Set pen width to ${width}px`}
                    style={{
                      padding: "8px",
                    }}
                  >
                    <div
                      className="bg-white rounded"
                      style={{
                        width: `${width}px`,
                        height: `${width}px`,
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Color Picker */}
        <div className="flex flex-col items-center gap-1 relative">
          <button
            onClick={() => {
              setShowColorPicker(!showColorPicker);
              setShowShapeMenu(false);
            }}
            className="p-2 hover:bg-orange-500/20 transition-colors"
            style={{
              backgroundColor: showColorPicker ? "rgba(255, 255, 255, 0.2)" : "transparent",
            }}
            title="Color Picker - Select drawing color"
          >
            <div
              className="w-5 h-5 rounded-full border-2 border-white/30"
              style={{ backgroundColor: getColorValue(selectedColor) }}
            />
          </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Color</span>
          {showColorPicker && (
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-2 rounded-lg"
              style={{
                background: "rgba(30, 30, 30, 0.95)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
              }}
            >
              <div className="flex flex-col items-center gap-2">
                {colors.map((color) => (
                  <button
                    key={color}
                    onClick={() => {
                      onColorSelect(color);
                      setShowColorPicker(false);
                    }}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      selectedColor === color
                        ? "border-white scale-110"
                        : "border-white/30"
                    }`}
                    style={{ backgroundColor: getColorValue(color) }}
                    title={color.charAt(0).toUpperCase() + color.slice(1)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div
              style={{
            width: "30px",
            height: "1px",
            background: "rgba(255, 255, 255, 0.2)",
            margin: "4px 0",
          }}
        />

        {/* Group 2: Capture */}
        {/* Screenshot */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
        <button
          onClick={onScreenshot}
          className="p-2 rounded-full hover:bg-orange-500/20 transition-colors"
            title="Screenshot - Capture the page with annotations"
        >
            <Camera size={20} color="white" strokeWidth={2} />
        </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Capture (C)</span>
        </div>

        {/* Full Screen Capture */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
        <button
          onClick={onDownload}
          className="p-2 rounded-full hover:bg-orange-500/20 transition-colors"
            title="Full Screen - Capture entire page"
        >
          <Maximize2 size={20} color="white" strokeWidth={2} />
        </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Full Screen (D)</span>
        </div>

        {/* Divider */}
        <div
          style={{
            width: "30px",
            height: "1px",
            background: "rgba(255, 255, 255, 0.2)",
            margin: "4px 0",
          }}
        />

        {/* Group 3: Undo/Redo */}
        {/* Undo */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
          onClick={onUndo}
          disabled={!canUndo}
          className={`p-2 rounded-full transition-colors ${
            canUndo ? "hover:bg-orange-500/20" : "opacity-50 cursor-not-allowed"
          }`}
          title="Undo"
        >
          <Undo size={20} color="white" strokeWidth={2} />
          </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Undo (Z)</span>
        </div>

        {/* Redo */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
          onClick={onRedo}
          disabled={!canRedo}
          className={`p-2 rounded-full transition-colors ${
            canRedo ? "hover:bg-orange-500/20" : "opacity-50 cursor-not-allowed"
          }`}
          title="Redo"
        >
          <Redo size={20} color="white" strokeWidth={2} />
          </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Redo (Y)</span>
        </div>

        {/* Clear All */}
        <div className="flex flex-col items-center gap-1" style={{ minWidth: "60px" }}>
          <button
          onClick={onClearAll}
          className="p-2 rounded-full hover:bg-orange-500/20 transition-colors"
          title="Clear All - Delete all annotations"
        >
          <Trash2 size={20} color="white" strokeWidth={2} />
          </button>
          <span className="text-white font-medium" style={{ fontSize: "9px" }}>Clear (X)</span>
        </div>
      </div>
    </div>
    </>
  );
}

