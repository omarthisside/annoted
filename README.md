# Proofly

A Chrome extension for annotating webpages with drawing tools, shapes, and screenshot capabilities.

## Features

- 🖊️ **Pen Tool**: Freehand drawing on any webpage
- 🎨 **Color Picker**: Choose from white, red, yellow, or blue
- 🔷 **Shapes**: Draw rectangles, circles, and arrows
- 📸 **Screenshot**: Capture the page with annotations
- 💾 **Download**: Save annotated screenshots as PNG files

## Development

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Create zip file
npm run zip
```

## Installation

1. Build the extension: `npm run build`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `.output/chrome-mv3` directory

## Usage

1. Click the extension icon to open the popup
2. Toggle the switch to enable annotation mode
3. Use the floating toolbar at the bottom of the page:
   - **Pen**: Click to draw freehand
   - **Color**: Select a color for drawing
   - **Shapes**: Choose rectangle, circle, or arrow
   - **Screenshot**: Capture the current viewport
   - **Download**: Save the annotated screenshot

## Tech Stack

- **Framework**: WXT Dev
- **Language**: TypeScript
- **UI**: React
- **Styling**: Tailwind CSS
- **Manifest**: Chrome Manifest V3

## Project Structure

```
proofly/
├── entrypoints/
│   ├── background.ts    # Background script for screenshots/downloads
│   ├── content.tsx      # Content script with canvas overlay
│   └── popup.tsx        # Popup UI for enable/disable
├── components/
│   └── Toolbar.tsx      # Floating toolbar component
├── utils/
│   ├── types.ts         # TypeScript types
│   └── canvas.ts        # Canvas drawing utilities
└── styles/
    └── global.css       # Global styles
```

## License

MIT

