/**
 * ChatGPT Minimap Navigator - Content Script
 * Creates a dynamic minimap for ChatGPT conversations with user message highlighting
 */

class ChatGPTMinimap {
  constructor() {
    this.minimap = null;
    this.minimapContainer = null;
    this.chatContainer = null;
    this.observer = null;
    this.userMessages = [];
    this.currentUserMessageIndex = -1;
    this.isScrollingFromMinimap = false;
    this.isScrollingFromMain = false;
    this.scrollTimeout = null;
    
    // Initialize the minimap when DOM is ready
    this.init();
  }

  /**
   * Initialize the minimap system
   */
  init() {
    // Wait for ChatGPT to load completely
    this.waitForChatGPT().then(() => {
      this.createMinimap();
      this.setupEventListeners();
      this.setupMutationObserver();
      this.updateMinimap();
      console.log('ChatGPT Minimap Navigator initialized');
    });
  }

  /**
   * Wait for ChatGPT interface to be fully loaded
   */
  async waitForChatGPT() {
    return new Promise((resolve) => {
      const checkForChat = () => {
        // Look for the main chat container
        const chatContainer = document.querySelector('[data-testid="conversation-turn-0"]')?.closest('div[class*="conversation"]') ||
                            document.querySelector('main div[class*="conversation"]') ||
                            document.querySelector('div[role="main"] div');
        
        if (chatContainer) {
          this.chatContainer = chatContainer.parentElement || chatContainer;
          resolve();
        } else {
          setTimeout(checkForChat, 500);
        }
      };
      checkForChat();
    });
  }

  /**
   * Create the minimap HTML structure
   */
  createMinimap() {
    // Create minimap container
    this.minimapContainer = document.createElement('div');
    this.minimapContainer.id = 'chatgpt-minimap-container';
    this.minimapContainer.innerHTML = `
      <div id="chatgpt-minimap-controls">
        <button id="prev-user-msg" title="Previous User Message">▲</button>
        <button id="next-user-msg" title="Next User Message">▼</button>
      </div>
      <div id="chatgpt-minimap"></div>
      <div id="minimap-tooltip"></div>
    `;
    
    // Append to body
    document.body.appendChild(this.minimapContainer);
    
    // Get minimap reference
    this.minimap = document.getElementById('chatgpt-minimap');
  }

  /**
   * Set up event listeners for navigation and scrolling
   */
  setupEventListeners() {
    const prevBtn = document.getElementById('prev-user-msg');
    const nextBtn = document.getElementById('next-user-msg');
    const tooltip = document.getElementById('minimap-tooltip');

    // Navigation button clicks
    prevBtn.addEventListener('click', () => this.navigateToUserMessage('prev'));
    nextBtn.addEventListener('click', () => this.navigateToUserMessage('next'));

    // Button hover events for preview
    prevBtn.addEventListener('mouseenter', (e) => this.showMessagePreview(e, 'prev'));
    nextBtn.addEventListener('mouseenter', (e) => this.showMessagePreview(e, 'next'));
    prevBtn.addEventListener('mouseleave', () => this.hideMessagePreview());
    nextBtn.addEventListener('mouseleave', () => this.hideMessagePreview());

    // Minimap scroll synchronization
    this.minimap.addEventListener('scroll', () => {
      if (!this.isScrollingFromMain) {
        this.isScrollingFromMinimap = true;
        this.syncMainChatFromMinimap();
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
          this.isScrollingFromMinimap = false;
        }, 100);
      }
    });

    // Main chat scroll synchronization
    window.addEventListener('scroll', () => {
      if (!this.isScrollingFromMinimap) {
        this.isScrollingFromMain = true;
        this.syncMinimapFromMainChat();
        clearTimeout(this.scrollTimeout);
        this.scrollTimeout = setTimeout(() => {
          this.isScrollingFromMain = false;
        }, 100);
      }
    });

    // Window resize handler
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * Set up MutationObserver to detect new messages
   */
  setupMutationObserver() {
    this.observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      
      mutations.forEach((mutation) => {
        // Check for added nodes that might be messages
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && 
                (node.querySelector('[data-message-author-role]') || 
                 node.hasAttribute('data-message-author-role'))) {
              shouldUpdate = true;
            }
          });
        }
        
        // Check for attribute changes on message elements
        if (mutation.type === 'attributes' && 
            mutation.attributeName === 'data-message-author-role') {
          shouldUpdate = true;
        }
      });
      
      if (shouldUpdate) {
        // Debounce updates to avoid excessive redraws
        clearTimeout(this.updateTimeout);
        this.updateTimeout = setTimeout(() => this.updateMinimap(), 100);
      }
    });

    // Start observing
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-message-author-role']
    });
  }

  /**
   * Update the minimap with current messages
   */
  updateMinimap() {
    if (!this.minimap) return;

    // Find all messages in the conversation
    const messages = document.querySelectorAll('[data-message-author-role]');
    this.userMessages = [];
    
    // Clear existing minimap content
    this.minimap.innerHTML = '';
    
    messages.forEach((message, index) => {
      const isUserMessage = message.getAttribute('data-message-author-role') === 'user';
      
      // Create minimap block
      const block = document.createElement('div');
      block.className = `minimap-block ${isUserMessage ? 'user-message' : 'ai-message'}`;
      block.dataset.messageIndex = index;
      
      // Store user message references
      if (isUserMessage) {
        this.userMessages.push({
          element: message,
          index: index,
          minimapBlock: block
        });
        
        // Add hover events for user message preview
        block.addEventListener('mouseenter', (e) => this.showMinimapMessagePreview(e, message));
        block.addEventListener('mouseleave', () => this.hideMessagePreview());
      }
      
      // Add click handler for navigation
      block.addEventListener('click', () => this.scrollToMessage(message));
      
      this.minimap.appendChild(block);
    });

    // Update navigation state
    this.updateNavigationState();
    this.syncMinimapFromMainChat();
  }

  /**
   * Show message preview tooltip for minimap blocks
   */
  showMinimapMessagePreview(event, messageElement) {
    const tooltip = document.getElementById('minimap-tooltip');
    if (!tooltip || !messageElement) return;

    const messageText = messageElement.textContent.trim();
    const preview = messageText.length > 20 
      ? messageText.substring(0, 20) + '...' 
      : messageText;

    tooltip.textContent = preview;
    tooltip.style.display = 'block';
    
    // Position tooltip near the minimap block
    const rect = event.target.getBoundingClientRect();
    tooltip.style.left = (rect.left - tooltip.offsetWidth - 10) + 'px';
    tooltip.style.top = rect.top + 'px';
  }

  /**
   * Show message preview tooltip
   */
  showMessagePreview(event, direction) {
    const tooltip = document.getElementById('minimap-tooltip');
    if (!tooltip) return;

    let targetIndex;
    if (direction === 'next') {
      targetIndex = (this.currentUserMessageIndex + 1) % this.userMessages.length;
    } else {
      targetIndex = this.currentUserMessageIndex <= 0 
        ? this.userMessages.length - 1 
        : this.currentUserMessageIndex - 1;
    }

    if (targetIndex >= 0 && targetIndex < this.userMessages.length) {
      const targetMessage = this.userMessages[targetIndex];
      const messageText = targetMessage.element.textContent.trim();
      const preview = messageText.length > 50 
        ? messageText.substring(0, 50) + '...' 
        : messageText;

      tooltip.textContent = preview;
      tooltip.style.display = 'block';
      
      // Position tooltip near the button
      const rect = event.target.getBoundingClientRect();
      tooltip.style.left = (rect.left - tooltip.offsetWidth - 10) + 'px';
      tooltip.style.top = rect.top + 'px';
    }
  }

  /**
   * Navigate to next or previous user message
   */
  navigateToUserMessage(direction) {
    if (this.userMessages.length === 0) return;

    if (direction === 'next') {
      this.currentUserMessageIndex = (this.currentUserMessageIndex + 1) % this.userMessages.length;
    } else {
      this.currentUserMessageIndex = this.currentUserMessageIndex <= 0 
        ? this.userMessages.length - 1 
        : this.currentUserMessageIndex - 1;
    }

    const targetMessage = this.userMessages[this.currentUserMessageIndex];
    if (targetMessage) {
      this.scrollToMessage(targetMessage.element);
      this.highlightCurrentMessage();
    }
  }

  /**
   * Scroll to a specific message
   */
  scrollToMessage(messageElement) {
    if (!messageElement) return;

    messageElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    // Update current user message index
    const userMsgIndex = this.userMessages.findIndex(msg => msg.element === messageElement);
    if (userMsgIndex !== -1) {
      this.currentUserMessageIndex = userMsgIndex;
      this.highlightCurrentMessage();
    }
  }

  /**
   * Highlight the current user message in the minimap
   */
  highlightCurrentMessage() {
    // Remove previous highlights
    this.minimap.querySelectorAll('.current-message').forEach(block => {
      block.classList.remove('current-message');
    });

    // Highlight current message
    if (this.currentUserMessageIndex >= 0 && 
        this.currentUserMessageIndex < this.userMessages.length) {
      const currentMsg = this.userMessages[this.currentUserMessageIndex];
      currentMsg.minimapBlock.classList.add('current-message');
    }
  }

  /**
   * Hide message preview tooltip
   */
  hideMessagePreview() {
    const tooltip = document.getElementById('minimap-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  /**
   * Synchronize main chat scroll from minimap
   */
  syncMainChatFromMinimap() {
    if (!this.minimap || this.isScrollingFromMain) return;

    const minimapScrollRatio = this.minimap.scrollTop / (this.minimap.scrollHeight - this.minimap.clientHeight);
    const mainScrollTarget = minimapScrollRatio * (document.documentElement.scrollHeight - window.innerHeight);
    
    window.scrollTo({
      top: mainScrollTarget,
      behavior: 'auto'
    });
  }

  /**
   * Synchronize minimap scroll from main chat
   */
  syncMinimapFromMainChat() {
    if (!this.minimap || this.isScrollingFromMinimap) return;

    const mainScrollRatio = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);
    const minimapScrollTarget = mainScrollRatio * (this.minimap.scrollHeight - this.minimap.clientHeight);
    
    this.minimap.scrollTop = minimapScrollTarget;
  }

  /**
   * Update navigation button states
   */
  updateNavigationState() {
    const prevBtn = document.getElementById('prev-user-msg');
    const nextBtn = document.getElementById('next-user-msg');
    
    if (prevBtn && nextBtn) {
      const hasUserMessages = this.userMessages.length > 0;
      prevBtn.disabled = !hasUserMessages;
      nextBtn.disabled = !hasUserMessages;
      
      if (this.currentUserMessageIndex === -1 && hasUserMessages) {
        this.currentUserMessageIndex = 0;
      }
    }
  }

  /**
   * Handle window resize
   */
  handleResize() {
    // Hide minimap on very small screens
    if (this.minimapContainer) {
      this.minimapContainer.style.display = window.innerWidth < 768 ? 'none' : 'flex';
    }
  }

  /**
   * Cleanup function
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.minimapContainer) {
      this.minimapContainer.remove();
    }
    clearTimeout(this.scrollTimeout);
    clearTimeout(this.updateTimeout);
  }
}

// Initialize the minimap when the page loads
let minimapInstance = null;

function initializeMinimap() {
  // Avoid duplicate initialization
  if (minimapInstance) {
    minimapInstance.destroy();
  }
  
  minimapInstance = new ChatGPTMinimap();
}

// Handle both initial load and navigation changes
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeMinimap);
} else {
  initializeMinimap();
}

// Handle navigation changes in single-page application
let currentUrl = location.href;
new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    setTimeout(initializeMinimap, 1000); // Delay to allow page to load
  }
}).observe(document, { subtree: true, childList: true });