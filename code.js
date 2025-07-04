// Comments Collator Plugin - Real Backend Integration
const BACKEND_URL = 'http://localhost:3000';

// Store session state
let sessionData = {
  token: null,
  user: null,
  fileKey: null
};

// Show the plugin UI
figma.showUI(__html__, { width: 400, height: 600 });

// Initialize plugin with file info
function initializePlugin() {
  sessionData.fileKey = figma.fileKey;
  
  figma.ui.postMessage({
    type: 'init',
    data: {
      fileKey: figma.fileKey,
      fileName: figma.root.name,
      hasBackend: true
    }
  });
  
  checkSelectionAndSendComments();
}

// Function to create a checkbox component
async function createCheckboxComponent(isChecked, isLightTheme) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  
  const checkboxFrame = figma.createFrame();
  checkboxFrame.name = isChecked ? "Checkbox (Checked)" : "Checkbox (Unchecked)";
  checkboxFrame.resize(16, 16);
  checkboxFrame.cornerRadius = 2;
  
  if (isChecked) {
    checkboxFrame.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.9 } }];
    checkboxFrame.strokes = [{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.9 } }];
  } else {
    checkboxFrame.fills = [];
    checkboxFrame.strokes = isLightTheme ? 
      [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }] : 
      [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
  }
  checkboxFrame.strokeWeight = 1;
  
  if (isChecked) {
    const checkmark = figma.createText();
    checkmark.characters = "✓";
    checkmark.fontSize = 10;
    checkmark.fontName = { family: "Inter", style: "Regular" };
    checkmark.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    checkmark.x = 3;
    checkmark.y = 2;
    checkboxFrame.appendChild(checkmark);
  }
  
  checkboxFrame.setPluginData('checkbox-state', isChecked ? 'checked' : 'unchecked');
  
  return checkboxFrame;
}

// Function to toggle checkbox state
async function toggleCheckbox(nodeId) {
  try {
    const node = await figma.getNodeByIdAsync(nodeId);
    if (!node) return;
    
    const currentState = node.getPluginData('checkbox-state');
    const newState = currentState === 'checked' ? 'unchecked' : 'checked';
    const isChecked = newState === 'checked';
    
    // Update backend if authenticated
    if (sessionData.token) {
      const commentId = node.getPluginData('comment-id');
      if (commentId && isChecked) {
        try {
          await resolveCommentInBackend(commentId);
        } catch (error) {
          console.error('Failed to resolve comment in backend:', error);
        }
      }
    }
    
    // Update visual state
    const backgrounds = figma.currentPage.backgrounds;
    const bgColor = backgrounds && backgrounds[0] ? backgrounds[0].color : null;
    const isLightTheme = !bgColor || (bgColor.r + bgColor.g + bgColor.b) / 3 > 0.5;
    
    if (isChecked) {
      node.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.9 } }];
      node.strokes = [{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.9 } }];
      
      if (node.children.length === 0) {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        const checkmark = figma.createText();
        checkmark.characters = "✓";
        checkmark.fontSize = 10;
        checkmark.fontName = { family: "Inter", style: "Regular" };
        checkmark.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        checkmark.x = 3;
        checkmark.y = 2;
        node.appendChild(checkmark);
      }
    } else {
      node.fills = [];
      node.strokes = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }] : 
        [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
      
      if (node.children.length > 0) {
        node.children[0].remove();
      }
    }
    
    node.setPluginData('checkbox-state', newState);
    node.name = isChecked ? "Checkbox (Checked)" : "Checkbox (Unchecked)";
    
    figma.notify(isChecked ? "Comment marked as resolved" : "Comment marked as unresolved");
    
  } catch (error) {
    console.error('Error toggling checkbox:', error);
  }
}

// Function to check current selection and send comments
async function checkSelectionAndSendComments() {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.ui.postMessage({ type: 'no-selection' });
    return;
  }
  
  const selectedNode = selection[0];
  
  if (selectedNode.type !== 'FRAME') {
    figma.ui.postMessage({ type: 'not-frame' });
    return;
  }
  
  try {
    // Update backend session if authenticated
    if (sessionData.token) {
      await updateSessionNode(selectedNode.id);
    }
    
    // Fetch comments from backend or use demo data
    const comments = await fetchCommentsForNode(selectedNode);
    
    figma.ui.postMessage({ 
      type: 'comments-data', 
      comments: comments,
      frameName: selectedNode.name,
      nodeId: selectedNode.id
    });
  } catch (error) {
    console.error('Error getting comments:', error);
    figma.ui.postMessage({ type: 'error', message: 'Failed to get comments: ' + error.message });
  }
}

// Function to fetch comments from backend or generate demo
async function fetchCommentsForNode(node) {
  try {
    if (!sessionData.token) {
      // Generate demo comments if not authenticated
      return generateDemoComments(node);
    }
    
    // Fetch real comments from backend
    const response = await makeAPIRequest(`/api/comments/${sessionData.fileKey}?nodeId=${node.id}`, 'GET');
    
    if (response.success) {
      return response.comments.map(comment => ({
        id: comment.id,
        text: comment.message,
        author: comment.author.handle || comment.author.name,
        timestamp: new Date(comment.createdAt).toLocaleString(),
        resolved: comment.isResolved,
        x: comment.position.x,
        y: comment.position.y,
        nodeId: comment.nodeId,
        nodeName: comment.nodeName
      }));
    } else {
      console.warn('Failed to fetch comments, using demo data');
      return generateDemoComments(node);
    }
    
  } catch (error) {
    console.error('Error fetching comments:', error);
    return generateDemoComments(node);
  }
}

// Generate demo comments
function generateDemoComments(node) {
  const demoComments = [
    {
      id: 'demo-1',
      text: `Review: The "${node.name}" frame looks good, but consider adjusting the spacing between elements.`,
      author: 'Design Team',
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleString(),
      resolved: false,
      x: 0,
      y: 0
    },
    {
      id: 'demo-2',
      text: `The color scheme in "${node.name}" works well with the overall design system. Nice work!`,
      author: 'Product Manager',
      timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toLocaleString(),
      resolved: true,
      x: 10,
      y: 20
    },
    {
      id: 'demo-3',
      text: `Could we make the text in "${node.name}" slightly larger for better readability?`,
      author: 'UX Researcher',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toLocaleString(),
      resolved: false,
      x: 5,
      y: 15
    }
  ];
  
  return demoComments;
}

// Make API request to backend
async function makeAPIRequest(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (sessionData.token) {
      options.headers['Authorization'] = `Bearer ${sessionData.token}`;
    }
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${BACKEND_URL}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
    
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

// Authenticate with session token
async function authenticateWithToken(token) {
  try {
    sessionData.token = token;
    
    const response = await makeAPIRequest('/auth/verify', 'POST', {
      session_token: token
    });
    
    if (response.success) {
      sessionData.user = response.user;
      figma.ui.postMessage({
        type: 'auth-success',
        user: response.user
      });
      
      // Refresh comments for current selection
      checkSelectionAndSendComments();
      
      return true;
    } else {
      sessionData.token = null;
      throw new Error(response.error || 'Authentication failed');
    }
    
  } catch (error) {
    sessionData.token = null;
    sessionData.user = null;
    figma.ui.postMessage({
      type: 'auth-error',
      message: error.message
    });
    return false;
  }
}

// Update session node in backend
async function updateSessionNode(nodeId) {
  try {
    await makeAPIRequest('/api/session/node', 'PUT', {
      nodeId: nodeId,
      fileKey: sessionData.fileKey
    });
  } catch (error) {
    console.error('Failed to update session node:', error);
  }
}

// Resolve comment in backend
async function resolveCommentInBackend(commentId) {
  try {
    await makeAPIRequest(`/api/comments/${sessionData.fileKey}/${commentId}/resolve`, 'PUT');
  } catch (error) {
    console.error('Failed to resolve comment in backend:', error);
    throw error;
  }
}

// Sync comments from backend
async function syncComments() {
  try {
    if (!sessionData.token) {
      figma.ui.postMessage({
        type: 'sync-error',
        message: 'Authentication required to sync comments'
      });
      return;
    }
    
    const response = await makeAPIRequest(`/api/files/${sessionData.fileKey}/sync`, 'POST');
    
    if (response.success) {
      figma.ui.postMessage({
        type: 'sync-success',
        message: `Synced ${response.commentsCount} comments`
      });
      
      // Refresh current comments
      checkSelectionAndSendComments();
    } else {
      throw new Error(response.error || 'Sync failed');
    }
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'sync-error',
      message: error.message
    });
  }
}

// Collate comments to canvas
async function collateCommentsToCanvas() {
  const selection = figma.currentPage.selection;
  
  if (selection.length === 0) {
    figma.notify("Please select a frame first");
    return;
  }
  
  const selectedFrame = selection[0];
  if (selectedFrame.type !== 'FRAME') {
    figma.notify("Please select a frame");
    return;
  }
  
  try {
    const comments = await fetchCommentsForNode(selectedFrame);
    
    if (comments.length === 0) {
      figma.notify("No comments found for this frame");
      return;
    }
    
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    
    // Create collated frame
    const collatedFrame = figma.createFrame();
    collatedFrame.name = `${selectedFrame.name} - Comments`;
    collatedFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    
    // Detect theme
    const backgrounds = figma.currentPage.backgrounds;
    const bgColor = backgrounds && backgrounds[0] ? backgrounds[0].color : null;
    const isLightTheme = !bgColor || (bgColor.r + bgColor.g + bgColor.b) / 3 > 0.5;
    
    if (!isLightTheme) {
      collatedFrame.fills = [{ type: 'SOLID', color: { r: 0x88/255, g: 0x88/255, b: 0x88/255 } }];
    }
    
    // Create header
    const header = figma.createText();
    header.characters = `Comments as of ${new Date().toLocaleString()}`;
    header.fontName = { family: "Inter", style: "Medium" };
    header.fontSize = 14;
    header.fills = isLightTheme ? 
      [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
      [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    
    let currentY = 20;
    header.x = 20;
    header.y = currentY;
    collatedFrame.appendChild(header);
    
    currentY += 40;
    
    // Add comments
    for (const comment of comments) {
      const isChecked = comment.resolved;
      
      // Create checkbox
      const checkbox = await createCheckboxComponent(isChecked, isLightTheme);
      checkbox.x = 20;
      checkbox.y = currentY;
      checkbox.setPluginData('comment-id', comment.id);
      collatedFrame.appendChild(checkbox);
      
      // Create comment text
      const commentText = figma.createText();
      commentText.characters = `${comment.author}: ${comment.text}`;
      commentText.fontName = { family: "Inter", style: "Regular" };
      commentText.fontSize = 10;
      commentText.fills = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
        [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      
      commentText.x = 46;
      commentText.y = currentY + 1;
      commentText.textAutoResize = "WIDTH_AND_HEIGHT";
      commentText.constraints = { horizontal: "MIN", vertical: "MIN" };
      
      collatedFrame.appendChild(commentText);
      
      currentY += Math.max(commentText.height + 12, 28);
    }
    
    // Set frame size
    const frameWidth = Math.max(400, selectedFrame.width);
    collatedFrame.resize(frameWidth, currentY + 20);
    
    // Position frame
    collatedFrame.x = selectedFrame.x;
    collatedFrame.y = selectedFrame.y - collatedFrame.height - 100;
    
    // Select the new frame
    figma.currentPage.selection = [collatedFrame];
    figma.viewport.scrollAndZoomIntoView([collatedFrame]);
    
    figma.notify(`Created comment collation with ${comments.length} comments`);
    
  } catch (error) {
    console.error('Error collating comments:', error);
    figma.notify('Error creating comment collation: ' + error.message);
  }
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'close') {
    figma.closePlugin();
  } else if (msg.type === 'collate-comments') {
    await collateCommentsToCanvas();
  } else if (msg.type === 'toggle-checkbox') {
    await toggleCheckbox(msg.nodeId);
  } else if (msg.type === 'authenticate') {
    await authenticateWithToken(msg.token);
  } else if (msg.type === 'open-auth') {
    const authUrl = `${BACKEND_URL}/auth/figma?file_key=${sessionData.fileKey}`;
    figma.ui.postMessage({
      type: 'open-url',
      url: authUrl
    });
  } else if (msg.type === 'sync-comments') {
    await syncComments();
  } else if (msg.type === 'logout') {
    sessionData.token = null;
    sessionData.user = null;
    figma.ui.postMessage({ type: 'logged-out' });
    checkSelectionAndSendComments();
  }
};

// Handle selection change
figma.on('selectionchange', () => {
  checkSelectionAndSendComments();
});

// Initialize plugin
initializePlugin(); 