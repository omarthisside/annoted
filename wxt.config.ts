import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Annoted",
    description: "Webpage annotation tool with drawing and screenshot capabilities",
    permissions: ["activeTab", "storage", "downloads", "scripting"],
    host_permissions: ["<all_urls>"],
    content_scripts: [
      {
        matches: ["<all_urls>"],
        js: ["content-scripts/content.js"],
        css: ["content-scripts/content.css"],
        run_at: "document_idle",
      },
    ],
    icons: {
      16: "/icon/annoted.png",
      32: "/icon/annoted.png",
      48: "/icon/annoted.png",
      128: "/icon/annoted.png",
    },
    // Explicitly define action without default_popup to allow onClicked to work
    action: {
      default_icon: {
        16: "/icon/annoted.png",
        32: "/icon/annoted.png",
        48: "/icon/annoted.png",
        128: "/icon/annoted.png",
      },
      // No default_popup - this allows chrome.action.onClicked to work
    },
  },
  hooks: {
    manifest: (manifest) => {
      // Ensure default_popup is completely removed if it exists
      if (manifest.action) {
        if (manifest.action.default_popup === null || 
            manifest.action.default_popup === undefined || 
            manifest.action.default_popup === '') {
          delete manifest.action.default_popup;
        }
      }
      return manifest;
    },
  },
  // Live reload is enabled by default in dev mode
  // The dev server watches for file changes and automatically rebuilds
  // Make sure to reload the extension in chrome://extensions/ after changes
});

