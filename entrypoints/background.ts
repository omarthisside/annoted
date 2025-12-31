import { defineBackground } from "wxt/sandbox";

export default defineBackground(() => {
  console.log("[Background] Proofly loaded");

  const captureScreenshot = async (tabId: number | undefined): Promise<string> => {
  if (!tabId) {
    throw new Error("No tab ID");
  }

  // First, get the page screenshot
  const pageScreenshot = await new Promise<string>((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      undefined,
      { format: "png", quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!dataUrl) {
          reject(new Error("Failed to capture screenshot"));
          return;
        }
        resolve(dataUrl);
      }
    );
  });

  // Then, get the canvas overlay from content script
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: "getCanvasData" },
      (response) => {
        if (chrome.runtime.lastError) {
          // If no canvas data, just return page screenshot
          resolve(pageScreenshot);
          return;
        }

        if (response?.canvasData) {
          // Composite canvas over page screenshot
          compositeScreenshots(pageScreenshot, response.canvasData)
            .then(resolve)
            .catch(() => resolve(pageScreenshot)); // Fallback to page only
        } else {
          resolve(pageScreenshot);
        }
      }
    );
  });
  };

  const compositeScreenshots = async (
  pageDataUrl: string,
  canvasDataUrl: string
  ): Promise<string> => {
    // In service worker context, we can't use DOM APIs
    // Ask content script to composite the images
  return new Promise((resolve, reject) => {
      // For now, since canvas is already overlaid on the page,
      // chrome.tabs.captureVisibleTab should capture both
      // Return the page screenshot which should include the canvas overlay
      resolve(pageDataUrl);
    });
  };

  const captureFullPage = async (tabId: number | undefined): Promise<{ dataUrl: string; isPDF: boolean }> => {
    if (!tabId) {
      throw new Error("No tab ID");
    }

    console.log("[Background] Starting full page capture for tab:", tabId);

    // Get page dimensions first - scroll to bottom first to trigger lazy loading
    const pageInfo = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Scroll to bottom to trigger any lazy-loaded content
        const maxScrollY = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        window.scrollTo(0, maxScrollY);
        
        // Wait a bit for content to load
        return new Promise((resolve) => {
          setTimeout(() => {
            // Scroll back to top
            window.scrollTo(0, 0);
            
            // Get dimensions after scrolling (to ensure all content is measured)
            const width = Math.max(
              document.body.scrollWidth,
              document.body.offsetWidth,
              document.documentElement.clientWidth,
              document.documentElement.scrollWidth,
              document.documentElement.offsetWidth,
              window.innerWidth
            );
            const height = Math.max(
              document.body.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight,
              window.innerHeight
            );
            
            resolve({
              width,
              height,
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
            });
          }, 500);
        });
      },
    });

    if (!pageInfo || !pageInfo[0]?.result) {
      throw new Error("Failed to get page dimensions");
    }

    const { width, height, viewportWidth, viewportHeight } = pageInfo[0].result;
    console.log("[Background] Page dimensions:", { width, height, viewportWidth, viewportHeight });

    // Even if page fits in viewport, still generate PDF for full page capture
    // This ensures consistency - full page button always generates PDF
    if (height <= viewportHeight && width <= viewportWidth) {
      console.log("[Background] Page fits in viewport, but still generating PDF for full page capture");
      // Continue with full page capture process to get PDF
    }

    // Ask content script to handle the scrolling and stitching
    return new Promise((resolve, reject) => {
      const resultListener = (message: any) => {
        if (message.action === "fullPageCaptureResult") {
          chrome.runtime.onMessage.removeListener(resultListener);
          if (message.screenshotData) {
            console.log("[Background] Full page capture successful, is PDF:", message.isPDF, "preview shown:", message.previewShown);
            // Preview modal in content script handles download, so we just resolve
            resolve({
              dataUrl: message.screenshotData,
              isPDF: message.isPDF === true
            });
          } else if (message.error) {
            console.error("[Background] Full page capture error:", message.error);
            // Fallback to regular screenshot
            captureScreenshot(tabId).then((dataUrl) => resolve({ dataUrl, isPDF: false })).catch(reject);
          } else {
            captureScreenshot(tabId).then((dataUrl) => resolve({ dataUrl, isPDF: false })).catch(reject);
          }
        }
      };
      
      chrome.runtime.onMessage.addListener(resultListener);
      
      // Send the capture request with page dimensions
      chrome.tabs.sendMessage(
        tabId,
        { 
          action: "captureFullPage",
          pageWidth: width,
          pageHeight: height,
          viewportWidth,
          viewportHeight
        },
        (response) => {
          if (chrome.runtime.lastError) {
            chrome.runtime.onMessage.removeListener(resultListener);
            console.warn("[Background] Full page capture message failed, using regular screenshot:", chrome.runtime.lastError);
            captureScreenshot(tabId).then((dataUrl) => resolve({ dataUrl, isPDF: false })).catch(reject);
            return;
}
          // Response will come via the resultListener
        }
      );
      
      // Timeout after 60 seconds (increased for large pages)
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(resultListener);
        console.warn("[Background] Full page capture timeout, using regular screenshot");
        captureScreenshot(tabId).then((dataUrl) => resolve({ dataUrl, isPDF: false })).catch(reject);
      }, 60000);
    });
  };

  const downloadScreenshot = async (tabId: number | undefined): Promise<void> => {
  if (!tabId) {
    throw new Error("No tab ID");
  }

  // Get screenshot
  const dataUrl = await captureScreenshot(tabId);

  // Get page title for filename
  const tab = await chrome.tabs.get(tabId);
  const pageTitle = tab.title || "page";
  const sanitizedTitle = pageTitle
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase()
    .substring(0, 50);

  const date = new Date().toISOString().split("T")[0];
  const filename = `proofly-${sanitizedTitle}-${date}.png`;

    console.log("[Background] Starting download with filename:", filename);
    console.log("[Background] Data URL length:", dataUrl.length);

    // Data URLs can be used directly with chrome.downloads.download
    return new Promise<void>((resolve, reject) => {
  chrome.downloads.download(
    {
          url: dataUrl,
      filename: filename,
          saveAs: true,
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message;
            console.error("[Background] Download error:", error);
            reject(new Error(error));
          } else {
            console.log("[Background] Download started successfully, ID:", downloadId);
            resolve();
          }
        }
      );
    });
  };

  const downloadFullPage = async (tabId: number | undefined): Promise<void> => {
    if (!tabId) {
      throw new Error("No tab ID");
    }

    console.log("[Background] Starting full page capture for tab:", tabId);
    
    // Get full page capture - this will trigger the preview modal in content script
    // The preview modal will handle the download, so we don't need to download here
    const result = await captureFullPage(tabId);
    console.log("[Background] Full page capture complete, preview should be shown in content script");
    
    // Preview modal in content script handles the download
    // We just need to acknowledge the capture is complete
    return Promise.resolve();
  };

  // Handle extension icon click - enable annotation on current tab
  // Check if chrome.action exists (Manifest V3) or use chrome.browserAction (Manifest V2)
  const actionAPI = chrome.action || (chrome as any).browserAction;
  
  if (actionAPI) {
    actionAPI.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
    console.log("[Background] Extension icon clicked, tab:", tab);
    if (!tab.id) {
      console.error("[Background] No tab ID");
      return;
    }
    
    try {
      // Content script should already be loaded via manifest
      // Try sending toggle message directly first
      chrome.tabs.sendMessage(tab.id, { action: "toggle" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("[Background] Content script not ready, injecting...", chrome.runtime.lastError.message);
          // If content script isn't ready, inject it
          chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            files: ["content-scripts/content.js"],
          }).then(() => {
            // Wait for script to initialize
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id!, { action: "toggle" }, (response) => {
                if (chrome.runtime.lastError) {
                  console.error("[Background] Failed to send message after injection:", chrome.runtime.lastError.message);
                } else {
                  console.log("[Background] Annotation toggled successfully after injection");
                }
              });
            }, 300);
          }).catch((error) => {
            console.error("[Background] Failed to inject content script:", error);
          });
        } else {
          console.log("[Background] Annotation toggled successfully, enabled:", response?.enabled);
        }
      });
    } catch (error) {
      console.error("[Background] Error toggling annotation:", error);
    }
    });
    console.log("[Background] Action click listener registered");
      } else {
    console.warn("[Background] chrome.action and chrome.browserAction are not available");
  }

  console.log("[Background] Setting up message listener");
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Background] Received message:", message, "from sender:", sender);
    if (message.action === "captureScreenshot") {
      captureScreenshot(sender.tab?.id)
        .then((dataUrl) => {
          chrome.storage.local.set({ prooflyScreenshot: dataUrl });
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("[Background] Screenshot error:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    }

    if (message.action === "downloadScreenshot") {
      console.log("[Background] Received downloadScreenshot message");
      const tabId = sender.tab?.id;
      console.log("[Background] Tab ID:", tabId);
      if (!tabId) {
        console.error("[Background] No tab ID available");
        sendResponse({ success: false, error: "No tab ID available" });
        return true;
      }
      
      downloadScreenshot(tabId)
        .then(() => {
          console.log("[Background] Download completed successfully");
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error("[Background] Download error:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep the message channel open for async response
    }

    if (message.action === "downloadFullPage") {
      console.log("[Background] Received downloadFullPage message");
      const tabId = sender.tab?.id;
      console.log("[Background] Tab ID:", tabId);
      if (!tabId) {
        console.error("[Background] No tab ID available");
        sendResponse({ success: false, error: "No tab ID available" });
        return false;
      }
      
      // Handle async operation
      downloadFullPage(tabId)
        .then(() => {
          console.log("[Background] Full page download completed successfully");
          // Try to send response, but don't fail if port is closed
          try {
            sendResponse({ success: true });
          } catch (e) {
            console.warn("[Background] Could not send response (port may be closed)");
          }
        })
        .catch((error) => {
          console.error("[Background] Full page download error:", error);
          // Try to send response, but don't fail if port is closed
          try {
            sendResponse({ success: false, error: error.message });
          } catch (e) {
            console.warn("[Background] Could not send error response (port may be closed)");
          }
        });
      return true; // Keep the message channel open for async response
    }

    if (message.action === "captureVisibleTab") {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ error: "No tab ID" });
        return true;
      }
      
      chrome.tabs.captureVisibleTab(
        undefined,
        { format: "png", quality: 100 },
        (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ dataUrl });
}
        }
      );
      return true;
    }

    return false;
  });
});

