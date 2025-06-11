// content_script.js

// --- Global State (for this content script instance) ---
let summaryData = null;
let currentPointIndex = 0;
let isPlaying = false;
let isPinned = false; // Tracks if the player is "pinned" open by a click
let pointIntervalId = null; 
let wordTimeoutId = null;
let currentPointTime = 0;
let autoScrollEnabled = false;
let playerContainer = null; // Holds the DOM element for the player
let collapseTimeout; // Timer for delayed collapse on mouse leave

// --- DOM Elements (will be populated when UI is built) ---
let playPauseBtn, prevBtn, nextBtn;
let currentTimeDisplay, totalTimeDisplay, pointIndicatorDisplay;
let currentPointTextDisplay;
let autoScrollCheckbox;
let headerTitleDisplay;
let closeBtn;

// --- Readability & Page Processing ---
// This returns the article content using Readability.js, which should be included in the page.
function extractArticleContent() {
  // Ensure Readability is loaded (it should be, as it's listed before this script in executeScript)
  if (typeof Readability === "undefined") {
    console.error("Readability.js not loaded!");
    alert("Error: Readability library not found. Cannot summarize.");
    return null;
  }
  const documentClone = document.cloneNode(true);
  const article = new Readability(documentClone).parse();

  if (article && article.content) {
    // For dummy summary, we'll send textContent. A real summarizer might want HTML.
    // To make text matching more robust, let's use a simple text extraction from content.
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = article.content;
    article.textContent = tempDiv.textContent || ""; // Use textContent of parsed HTML
    return { title: article.title, content: article.textContent, htmlContent: article.content };
  }
  return null;
}

// --- UI Creation ---
function createPlayerUI() {
  if (document.getElementById('readaloud-summary-player-container')) {
    console.log("Player UI already exists.");
    playerContainer = document.getElementById('readaloud-summary-player-container');
    // Re-populate element vars if needed or ensure they are correctly assigned
    // This might happen if script re-runs or has partial state
    assignPlayerElementVars();
    updatePlayerDisplay();
    playerContainer.style.display = 'flex'; // Ensure it's visible
    return;
  }

  playerContainer = document.createElement('div');
  playerContainer.id = 'readaloud-summary-player-container';
  playerContainer.innerHTML = `
    <div class="rsp-header">
      <span class="rsp-header-title" title="Article Summary">Article Summary</span>
      <button class="rsp-close-btn" title="Close Player">×</button>
    </div>
    <div class="rsp-current-point-text">Waiting for summary...</div>
    <div class="rsp-progress">
      <span class="rsp-time">0:00 / 0:00</span>
      <span class="rsp-point-indicator">0/0</span>
    </div>
    <div class="rsp-controls">
      <button id="rsp-prev-btn" title="Previous Point">‹ Prev</button>
      <button id="rsp-play-pause-btn" title="Play">Play ►</button>
      <button id="rsp-next-btn" title="Next Point">Next ›</button>
    </div>
    <div class="rsp-settings">
      <label>
        <input type="checkbox" id="rsp-autoscroll-cb"> Auto-scroll to section
      </label>
    </div>
  `;
  document.body.appendChild(playerContainer);
  assignPlayerElementVars();
  addEventListeners();
  loadSettings(); // Load auto-scroll preference
}

function assignPlayerElementVars() {
    headerTitleDisplay = playerContainer.querySelector('.rsp-header-title'); // not needed
    closeBtn = playerContainer.querySelector('.rsp-close-btn');
    currentPointTextDisplay = playerContainer.querySelector('.rsp-current-point-text');
    playPauseBtn = document.getElementById('rsp-play-pause-btn');
    prevBtn = document.getElementById('rsp-prev-btn');
    nextBtn = document.getElementById('rsp-next-btn');
    const timeDisplaySpan = playerContainer.querySelector('.rsp-time'); // need to change to countdown rather than total time
    // These might not exist if summaryData isn't loaded, so check:
    if (timeDisplaySpan) currentTimeDisplay = timeDisplaySpan; // Will be updated dynamically
    if (timeDisplaySpan) totalTimeDisplay = timeDisplaySpan; // Will be updated dynamically
    pointIndicatorDisplay = playerContainer.querySelector('.rsp-point-indicator');
    autoScrollCheckbox = document.getElementById('rsp-autoscroll-cb'); // not needed
}


function addEventListeners() {
  playPauseBtn.addEventListener('click', togglePlayPause); // need to change togglePlayPause for design use ⏸
  prevBtn.addEventListener('click', prevPoint); 
  nextBtn.addEventListener('click', nextPoint);
  autoScrollCheckbox.addEventListener('change', (e) => { // can remove this and autoscroll for the time being
    autoScrollEnabled = e.target.checked;
    saveSettings(); // no need to worry about setting persistence
  });

  closeBtn.addEventListener('click', () => {
    if (playerContainer) {
        pausePlayback(); // Stop audio if playing
        playerContainer.style.display = 'none'; // Hide it
    }
  });

  playerContainer.addEventListener('mouseenter', () => { // need to rewrite this and mouse leave, MVP can do without expanded / minimized versions
    playerContainer.classList.add('expanded');
    currentPointTextDisplay.classList.add('expanded-text');
    if (summaryData && summaryData.points.length > 0) {
        renderCurrentPointTextWithWordSpans(); // Show word spans on hover
    }
  });

  playerContainer.addEventListener('mouseleave', () => {
    playerContainer.classList.remove('expanded');
    currentPointTextDisplay.classList.remove('expanded-text');
    if (summaryData && summaryData.points.length > 0) {
        // Revert to simple text or just ensure no words are highlighted if not playing
        loadPointIntoPlayer(currentPointIndex, isPlaying);
    }
  });
}

// --- Playback Logic ---
function togglePlayPause() { // update the playPauseBtn to reflect new UI
  if (!summaryData || summaryData.points.length === 0) return;
  isPlaying = !isPlaying;
  if (isPlaying) {
    playCurrentPoint();
    playPauseBtn.textContent = 'Pause ❚❚';
    playPauseBtn.title = 'Pause';
  } else {
    pausePlayback();
    playPauseBtn.textContent = 'Play ►';
    playPauseBtn.title = 'Play';
  }
}

function playCurrentPoint() {
  if (!summaryData || !summaryData.points[currentPointIndex]) return;

  const point = summaryData.points[currentPointIndex];
  isPlaying = true; // Ensure state is correct
  playPauseBtn.textContent = 'Pause ❚❚';
  playPauseBtn.title = 'Pause';

  // Simulate audio playback with word highlighting - can implment real audio matching later
  clearTimeout(wordTimeoutId);
  clearInterval(pointIntervalId); // Clear any existing point interval

  let wordIdx = 0;
  const highlightNextWord = () => {
    if (!isPlaying || wordIdx >= point.wordTimings.length) {
      if (isPlaying && wordIdx >= point.wordTimings.length) { // Point finished
        currentPointTime = point.duration; // Ensure time is set to full duration
        updatePlayerTimeDisplay();
        if (currentPointIndex < summaryData.points.length - 1) {
          nextPoint(); // Auto-play next if not last
        } else {
          pausePlayback(); // End of all points
          playPauseBtn.textContent = 'Play ►';
          playPauseBtn.title = 'Play';
        }
      }
      return;
    }

    const { word, start, end } = point.wordTimings[wordIdx];
    const delay = (start - (currentPointTime > start ? currentPointTime : 0)) * 1000; // Delay until word's start time
    
    // Update currentPointTime based on word progression
    // This is a bit simplified; for true resume, one would track currentPointTime more precisely
    currentPointTime = start; // Jump time to the start of the current word
    updatePlayerTimeDisplay();
    highlightWordInPlayer(wordIdx);

    wordTimeoutId = setTimeout(() => {
      currentPointTime = end; // Advance time to the end of the current word
      updatePlayerTimeDisplay();
      wordIdx++;
      highlightNextWord();
    }, (end - start) * 1000);
  };

  // Point timer for overall progress (less granular than word)
  pointIntervalId = setInterval(() => {
      if (!isPlaying) {
          clearInterval(pointIntervalId);
          return;
      }
      // currentPointTime is mainly driven by word timings now.
      // This interval can be a fallback or for display updates if word timings are coarse.
      // For this demo, word timings drive currentPointTime.
      // We could use this interval to simply ensure the display updates if nothing else is happening.
      // updatePlayerTimeDisplay(); 
  }, 250); // Update display periodically

  highlightNextWord(); // Start word highlighting sequence
}


function pausePlayback() {
  isPlaying = false;
  clearInterval(pointIntervalId);
  clearTimeout(wordTimeoutId);
  if (playPauseBtn) { // Check if button exists
    playPauseBtn.textContent = 'Play ►';
    playPauseBtn.title = 'Play';
  }
  // Optionally remove word highlight when paused
  renderCurrentPointTextWithWordSpans(false); // false = don't highlight any specific word
}

function nextPoint() {
  if (!summaryData) return;
  if (currentPointIndex < summaryData.points.length - 1) {
    currentPointIndex++;
    loadPointIntoPlayer(currentPointIndex, isPlaying);
  }
}

function prevPoint() {
  if (!summaryData) return;
  if (currentPointIndex > 0) {
    currentPointIndex--;
    loadPointIntoPlayer(currentPointIndex, isPlaying);
  }
}

// --- UI Updates ---
function loadPointIntoPlayer(index, shouldContinuePlaying = false) {
  if (!summaryData || !summaryData.points[index]) return;
  currentPointIndex = index;
  currentPointTime = 0; // Reset time for the new point

  const point = summaryData.points[index];
  
  renderCurrentPointTextWithWordSpans(); // Renders with spans, no highlight initially
  updatePlayerTimeDisplay(); // total time will be set here

  pointIndicatorDisplay.textContent = `${index + 1}/${summaryData.points.length}`;

  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === summaryData.points.length - 1;

  highlightSectionInPage(point.originalTextRef); // don't need this initially

  if (shouldContinuePlaying) {
    playCurrentPoint();
  } else {
    pausePlayback(); // Ensure it's paused if not continuing
    updatePlayerTimeDisplay(); // Update time display for new point (0:00 / X:XX)
  }
}

function renderCurrentPointTextWithWordSpans(activeWordIndex = -1) {
    if (!summaryData || !summaryData.points[currentPointIndex] || !currentPointTextDisplay) return;

    const point = summaryData.points[currentPointIndex];
    currentPointTextDisplay.innerHTML = ''; // Clear previous content

    point.wordTimings.forEach((timing, index) => {
        const wordSpan = document.createElement('span');
        wordSpan.textContent = timing.word + ' ';
        if (index === activeWordIndex && playerContainer.classList.contains('expanded')) {
            wordSpan.classList.add('word-highlight');
        }
        currentPointTextDisplay.appendChild(wordSpan);
    });
}


function highlightWordInPlayer(wordIndex) {
    if (!playerContainer.classList.contains('expanded')) return; // Only highlight if expanded

    const wordSpans = currentPointTextDisplay.querySelectorAll('span');
    wordSpans.forEach((span, idx) => {
        if (idx === wordIndex) {
            span.classList.add('word-highlight');
        } else {
            span.classList.remove('word-highlight');
        }
    });
}


function updatePlayerDisplay() {
  if (!summaryData || !playerContainer) {
    console.log("updatePlayerDisplay: No summary data or player container.");
    if (playerContainer) { // If player exists but no data (e.g. error state)
        currentPointTextDisplay.textContent = "Could not load summary.";
        pointIndicatorDisplay.textContent = "0/0";
        currentTimeDisplay.textContent = "0:00 / 0:00";
        playPauseBtn.disabled = true;
        prevBtn.disabled = true;
        nextBtn.disabled = true;
    }
    return;
  }

  if (summaryData.points.length === 0) {
    currentPointTextDisplay.textContent = "No summary points available for this article.";
    pointIndicatorDisplay.textContent = "0/0";
    currentTimeDisplay.textContent = "0:00";
    playPauseBtn.disabled = true;
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  
  playPauseBtn.disabled = false; // Enable if there are points - don't need the title displays
  headerTitleDisplay.textContent = summaryData.title ? `Summary: ${summaryData.title.substring(0,30)}...` : "Article Summary";
  headerTitleDisplay.title = summaryData.title || "Article Summary";

  loadPointIntoPlayer(currentPointIndex, isPlaying); // This will set up the current point
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${min}:${sec}`;
}

function updatePlayerTimeDisplay() {
  if (!summaryData || !summaryData.points[currentPointIndex] || !currentTimeDisplay) return;
  const point = summaryData.points[currentPointIndex];
  const currentTimeFormatted = formatTime(currentPointTime);
  const totalTimeFormatted = formatTime(point.duration);
  currentTimeDisplay.textContent = `${currentTimeFormatted} / ${totalTimeFormatted}`;
}

// --- On-Page Highlighting & Scrolling --- // Can be removed for MVP
let currentHighlightedElement = null;

function findElementByTextContent(textToFind) {
    // This is a simplified search. For complex pages, might need more robust matching.
    // Consider searching within the Readability-parsed content's main container if you inject it.
    // For now, search common text-container elements.
    const selectors = ['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'span', 'div'];
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            // Normalize whitespace and compare. Be careful with partial matches.
            // For a robust solution, character offsets or more precise DOM paths are better.
            if (el.textContent && el.textContent.trim().includes(textToFind.trim())) {
                // Ensure it's visible and not part of our player
                if (el.offsetWidth > 0 || el.offsetHeight > 0) {
                    if (!playerContainer || !playerContainer.contains(el)) {
                         // Prioritize elements that are closer to an exact match in length
                        if (Math.abs(el.textContent.trim().length - textToFind.trim().length) < textToFind.trim().length * 0.3) { // Allow 30% length diff
                           return el;
                        }
                    }
                }
            }
        }
    }
    console.warn("Could not find element for text:", textToFind);
    return null; // Fallback if no good match
}


function highlightSectionInPage(textRef) {
  // Remove previous highlight
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('readaloud-summary-highlight');
    currentHighlightedElement.classList.remove('readaloud-summary-highlight-active');
  }

  const elementToHighlight = findElementByTextContent(textRef);

  if (elementToHighlight) {
    currentHighlightedElement = elementToHighlight;
    elementToHighlight.classList.add('readaloud-summary-highlight');
    elementToHighlight.classList.add('readaloud-summary-highlight-active'); // Make it active

    if (autoScrollEnabled) {
      elementToHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Remove 'active' after a bit to distinguish from persistent highlight
    setTimeout(() => {
        if (elementToHighlight) elementToHighlight.classList.remove('readaloud-summary-highlight-active');
    }, 1500);
  }
}


// --- Settings Persistence ---
function saveSettings() {
  chrome.storage.local.set({ autoScrollEnabled });
}

function loadSettings() {
  chrome.storage.local.get(['autoScrollEnabled'], (result) => {
    autoScrollEnabled = !!result.autoScrollEnabled;
    if (autoScrollCheckbox) autoScrollCheckbox.checked = autoScrollEnabled;
  });
}


// --- Initialization ---
async function init() {
  console.log("Content script init triggered.");
  createPlayerUI(); // Create UI shell first
  currentPointTextDisplay.textContent = "Extracting article content...";

  const article = extractArticleContent();
  if (article) {
    currentPointTextDisplay.textContent = "Generating summary...";
    try {
      const response = await chrome.runtime.sendMessage({ action: "processPage", article });
      if (response && response.status === "success") {
        summaryData = response.summaryData;
        if (summaryData && summaryData.points && summaryData.points.length > 0) {
          currentPointIndex = 0;
          updatePlayerDisplay();
        } else {
          currentPointTextDisplay.textContent = summaryData.title ? `No summary points for: ${summaryData.title}.` : "No summary points available.";
          if (playerContainer) playPauseBtn.disabled = true;
        }
      } else {
        currentPointTextDisplay.textContent = "Error generating summary: " + (response.message || "Unknown error");
        if (playerContainer) playPauseBtn.disabled = true;
         console.error("Error from service worker:", response);
      }
    } catch (error) {
      currentPointTextDisplay.textContent = "Error communicating with extension backend.";
      if (playerContainer) playPauseBtn.disabled = true;
      console.error("Error sending message to service worker:", error);
    }
  } else {
    currentPointTextDisplay.textContent = "Could not extract article content.";
    if (playerContainer) playPauseBtn.disabled = true;
  }
}

// --- Message listener for content script ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "togglePlayer") {
        if (playerContainer) {
            const isVisible = playerContainer.style.display !== 'none';
            playerContainer.style.display = isVisible ? 'none' : 'flex';
            if (!isVisible && summaryData) { // If making visible and data exists
                updatePlayerDisplay(); // Refresh display, e.g. active highlights
            } else if (isVisible) { // If hiding
                pausePlayback();
            }
            sendResponse({status: "toggled", nowVisible: !isVisible});
        } else {
            // Player not initialized, so initialize it
            init();
            sendResponse({status: "initialized"});
        }
        return true; // Async if needed, though not strictly here
    }
});


// --- Auto-initialize if the script is injected ---
// This ensures that if the content_script.js is executed (e.g., by chrome.action.onClicked),
// it attempts to initialize the player.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // The DOM is already loaded
  // Check if already initialized to prevent double execution if script is somehow injected multiple times
  if (!document.getElementById('readaloud-summary-player-container')) {
    init();
  }
}