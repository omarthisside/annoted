# How to Run and Install Proofly Chrome Extension

## 🚀 Running in Development Mode with Live Reload

1. **Start the development server:**
   ```bash
   yarn dev
   # or
   npm run dev
   ```

2. The extension will be built to `.output/chrome-mv3` directory with **live reload enabled**.

3. **How Live Reload Works:**
   - WXT automatically watches for file changes in your project
   - When you save a file, WXT rebuilds the extension automatically
   - The extension in Chrome needs to be reloaded to see changes
   
4. **To see changes in Chrome:**
   - Go to `chrome://extensions/`
   - Find your Proofly extension
   - Click the **reload icon** (circular arrow) on the extension card
   - Or enable "Auto-reload" by right-clicking the extension and selecting it (if available)
   
   **Pro Tip:** Keep the `chrome://extensions/` page open in a tab while developing for quick reloads!

## 📦 Building for Production

1. **Build the extension:**
   ```bash
   yarn build
   # or
   npm run build
   ```

2. The built extension will be in `.output/chrome-mv3` directory.

## 🔌 Installing in Chrome

1. **Open Chrome** and navigate to:
   ```
   chrome://extensions/
   ```

2. **Enable Developer Mode:**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension:**
   - Click "Load unpacked" button
   - Navigate to your project directory
   - Select the `.output/chrome-mv3` folder
   - Click "Select"

4. **Verify Installation:**
   - You should see the Proofly extension icon in your Chrome toolbar
   - Click it to open the popup

## 🎯 Using the Extension

1. Click the extension icon in Chrome toolbar
2. Toggle the switch to enable annotation mode
3. A floating toolbar will appear at the bottom of the page
4. Use the tools to draw, add shapes, take screenshots, and download

## ⚠️ Note About Icons

The extension configuration references icon files in `/icon/` directory. If you see errors about missing icons:
- Create an `icon` folder in the `public` directory (or root)
- Add icon files: `16.png`, `32.png`, `48.png`, `128.png`
- Or WXT will use default icons if the folder doesn't exist

## 🛠️ Troubleshooting

- **Extension not loading?** Make sure you selected the `.output/chrome-mv3` folder, not the project root
- **Changes not appearing?** In development mode, reload the extension in `chrome://extensions/` after changes
- **Build errors?** Make sure all dependencies are installed: `yarn install` or `npm install`

