// service-worker.js

// --- Dummy API/Processing Logic ---
async function getDummySummaryAndTTS(articleContent, articleTitle) {
  console.log("ServiceWorker: Generating dummy summary for:", articleTitle);

  // 1. Create dummy summary points (e.g., first few paragraphs or sentences)
  // For simplicity, let's assume articleContent is plain text for this dummy function
  // In reality, you'd parse HTML from Readability's output.
  const sentences = articleContent.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const summaryPointsData = [];
  const numPoints = Math.min(sentences.length, 5); // Max 5 points

  for (let i = 0; i < numPoints; i++) {
    const text = sentences[i]?.trim() || `This is dummy summary point ${i + 1} for the article. It's a bit longer to simulate a real sentence.`;
    if (!text) continue;

    const words = text.split(/\s+/);
    const dummyDuration = words.length * 0.4; // Avg 0.4s per word
    const wordTimings = [];
    let currentTime = 0;
    for (const word of words) {
      const wordDuration = 0.4; // Fixed for dummy
      wordTimings.push({ word, start: currentTime, end: currentTime + wordDuration });
      currentTime += wordDuration;
    }

    summaryPointsData.push({
      id: `point-${i}`,
      text: text,
      originalTextRef: text, // For matching in content script
      dummyAudioUrl: `dummy_audio_for_point_${i}.mp3`, // Not used
      duration: dummyDuration,
      wordTimings: wordTimings
    });
  }

  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log("ServiceWorker: Dummy summary generated:", summaryPointsData);
  return { title: articleTitle, points: summaryPointsData };
}


// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processPage") {
    getDummySummaryAndTTS(request.article.content, request.article.title)
      .then(summaryData => {
        sendResponse({ status: "success", summaryData });
      })
      .catch(error => {
        console.error("Error processing page:", error);
        sendResponse({ status: "error", message: error.toString() });
      });
    return true; // Indicates asynchronous response
  }
});

// --- Extension Icon Click ---
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Check if player already exists for this tab to avoid multiple injections
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!document.getElementById('readaloud-summary-player-container')
    });
    if (results[0].result) {
      console.log("Player already injected or injection in progress.");
      // Optionally, send a message to toggle visibility or re-focus
      chrome.tabs.sendMessage(tab.id, { action: "togglePlayer" });
      return;
    }
  } catch (e) {
    console.warn("Could not check for existing player (likely a restricted page):", e);
    // Potentially show a notification to the user that the page is restricted
    return;
  }


  // Inject content script and CSS
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['player.css']
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['Readability.js', 'content_script.js']
    });
    // After injecting, content_script.js will send "init" message
  } catch (err) {
    console.error(`Failed to inject scripts: ${err}`);
  }
});