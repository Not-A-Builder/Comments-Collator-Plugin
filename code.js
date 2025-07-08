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
  
  // Check for existing session before showing auth screen
  checkForExistingSession();
}

// Check for existing valid session
async function checkForExistingSession() {
  try {
    console.log('Checking for existing session...');
    
    const response = await makeAPIRequest(`/auth/check-session?file_key=${sessionData.fileKey}`, 'GET');
    
    if (response.success && response.hasValidSession) {
      console.log('Found existing session, auto-connecting...');
      
      // Auto-connect with existing session
      sessionData.token = response.session.token;
      sessionData.user = response.session.user;
      
      figma.ui.postMessage({
        type: 'auto-connected',
        user: response.session.user,
        message: 'Auto-connected with existing session'
      });
      
      // Load comments for current selection
      checkSelectionAndSendComments();
      
    } else {
      console.log('No existing session found, showing auth screen');
      figma.ui.postMessage({
        type: 'show-auth-screen'
      });
    }
    
  } catch (error) {
    console.error('Error checking for existing session:', error);
    // Fall back to showing auth screen
    figma.ui.postMessage({
      type: 'show-auth-screen'
    });
  }
}

// Function to create a checkbox component
async function createCheckboxComponent(isChecked, isLightTheme) {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  
  const checkboxFrame = figma.createFrame();
  checkboxFrame.name = isChecked ? "Checkbox (Checked) - Click to unmark" : "Checkbox (Unchecked) - Click to resolve";
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
      if (commentId) {
        try {
          if (isChecked) {
            // Resolve the comment
            await resolveCommentInBackend(commentId);
          } else {
            // Unresolve the comment (mark as active again)
            await unresolveCommentInBackend(commentId);
          }
        } catch (error) {
          console.error('Failed to update comment in backend:', error);
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
    node.name = isChecked ? "Checkbox (Checked) - Click to unmark" : "Checkbox (Unchecked) - Click to resolve";
    
    figma.notify(isChecked ? "Comment marked as resolved" : "Comment marked as unresolved");
    
    // Refresh comments in UI to update the list (resolved comments will be filtered out)
    setTimeout(() => {
      checkSelectionAndSendComments();
    }, 500); // Small delay to allow backend update
    
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
      // Filter to show only unresolved comments
      return response.comments
        .filter(comment => !comment.isResolved)
        .map(comment => ({
          id: comment.id,
          text: comment.message,
          author: comment.author.handle || comment.author.name,
          timestamp: new Date(comment.createdAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
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
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }),
      resolved: false,
      x: 0,
      y: 0
    },
    {
      id: 'demo-3',
      text: `Could we make the text in "${node.name}" slightly larger for better readability?`,
      author: 'UX Researcher',
      timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }),
      resolved: false,
      x: 5,
      y: 15
    }
  ];
  
  // Filter to show only unresolved comments  
  return demoComments.filter(comment => !comment.resolved);
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

// Unresolve comment in backend
async function unresolveCommentInBackend(commentId) {
  try {
    await makeAPIRequest(`/api/comments/${sessionData.fileKey}/${commentId}/unresolve`, 'PUT');
  } catch (error) {
    console.error('Failed to unresolve comment in backend:', error);
    throw error;
  }
}

// Sync canvas comments from backend
async function syncCanvasComments(operationId = null) {
  try {
    if (!sessionData.token) {
      figma.ui.postMessage({
        type: 'sync-error',
        message: 'Authentication required to sync comments',
        operationId: operationId
      });
      return;
    }
    
    const response = await makeAPIRequest(`/api/files/${sessionData.fileKey}/sync`, 'POST');
    
    if (response.success) {
      figma.ui.postMessage({
        type: 'sync-success',
        message: `Synced ${response.commentsCount} comments`,
        operationId: operationId
      });
      
      // Fetch and show canvas comments
      await fetchAndShowCanvasComments();
    } else {
      throw new Error(response.error || 'Sync failed');
    }
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'sync-error',
      message: error.message,
      operationId: operationId
    });
  }
}

// Sync frame comments from backend
async function syncFrameComments(operationId = null) {
  try {
    if (!sessionData.token) {
      figma.ui.postMessage({
        type: 'sync-error',
        message: 'Authentication required to sync comments',
        operationId: operationId
      });
      return;
    }
    
    const response = await makeAPIRequest(`/api/files/${sessionData.fileKey}/sync`, 'POST');
    
    if (response.success) {
      figma.ui.postMessage({
        type: 'sync-success',
        message: `Synced ${response.commentsCount} comments`,
        operationId: operationId
      });
      
      // Refresh current selection comments
      checkSelectionAndSendComments();
    } else {
      throw new Error(response.error || 'Sync failed');
    }
    
  } catch (error) {
    figma.ui.postMessage({
      type: 'sync-error',
      message: error.message,
      operationId: operationId
    });
  }
}

// Fetch and show canvas comments
async function fetchAndShowCanvasComments() {
  try {
    if (!sessionData.token) {
      // Generate demo canvas comments if not authenticated
      const demoCanvasComments = [
        {
          id: 'demo-canvas-1',
          text: 'This is a canvas-level comment not associated with any frame',
          author: 'Design Team',
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          resolved: false,
          x: 0,
          y: 0,
          nodeId: null
        },
        {
          id: 'demo-canvas-2',
          text: 'General feedback about the overall page layout',
          author: 'Product Manager',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          resolved: false,
          x: 10,
          y: 10,
          nodeId: null
        }
      ];
      
      figma.ui.postMessage({
        type: 'canvas-comments-data',
        comments: demoCanvasComments
      });
      return;
    }
    
    // Fetch canvas-level comments from backend (not associated with frames)
    const response = await makeAPIRequest(`/api/comments/${sessionData.fileKey}/canvas`, 'GET');
    
    if (response.success) {
      // Filter to show only unresolved comments
      const unresolvedComments = response.comments
        .filter(comment => !comment.isResolved)
        .map(comment => ({
          id: comment.id,
          text: comment.message,
          author: comment.author.handle || comment.author.name,
          timestamp: new Date(comment.createdAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          resolved: comment.isResolved,
          x: comment.position.x,
          y: comment.position.y,
          nodeId: comment.nodeId,
          nodeName: comment.nodeName
        }));
      
      figma.ui.postMessage({
        type: 'canvas-comments-data',
        comments: unresolvedComments
      });
    } else {
      throw new Error(response.error || 'Failed to fetch canvas comments');
    }
    
  } catch (error) {
    console.error('Error fetching canvas comments:', error);
    figma.ui.postMessage({ type: 'error', message: 'Failed to fetch canvas comments: ' + error.message });
  }
}

// Collate canvas comments to canvas
async function collateCanvasCommentsToCanvas() {
  try {
    let comments = [];
    
    if (!sessionData.token) {
      // Generate demo canvas comments if not authenticated
      const demoCanvasComments = [
        {
          id: 'demo-canvas-1',
          text: 'This is a canvas-level comment not associated with any frame',
          author: 'Design Team',
          timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          resolved: false,
          x: 0,
          y: 0,
          nodeId: null
        },
        {
          id: 'demo-canvas-2',
          text: 'General feedback about the overall page layout',
          author: 'Product Manager',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          resolved: false,
          x: 10,
          y: 10,
          nodeId: null
        }
      ];
      
      // Filter to only unresolved comments
      comments = demoCanvasComments.filter(comment => !comment.resolved);
    } else {
      // Fetch canvas-level comments from backend (not associated with frames)
      const response = await makeAPIRequest(`/api/comments/${sessionData.fileKey}/canvas`, 'GET');
      
      if (response.success) {
        // Filter to show only unresolved comments
        comments = response.comments
          .filter(comment => !comment.isResolved)
          .map(comment => ({
            id: comment.id,
            text: comment.message,
            author: comment.author.handle || comment.author.name,
            timestamp: new Date(comment.createdAt).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            }),
            resolved: comment.isResolved,
            x: comment.position.x,
            y: comment.position.y,
            nodeId: comment.nodeId,
            nodeName: comment.nodeName
          }));
      } else {
        throw new Error(response.error || 'Failed to fetch canvas comments');
      }
    }
    
    if (comments.length === 0) {
      figma.notify("No unresolved canvas comments found");
      return;
    }
    
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    
    // Create collated frame with auto-layout
    const collatedFrame = figma.createFrame();
    collatedFrame.name = `Canvas - Comments`;
    collatedFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    
    // Set up auto-layout
    collatedFrame.layoutMode = "VERTICAL";
    collatedFrame.paddingTop = 20;
    collatedFrame.paddingBottom = 20;
    collatedFrame.paddingLeft = 20;
    collatedFrame.paddingRight = 20;
    collatedFrame.itemSpacing = 16;
    collatedFrame.primaryAxisSizingMode = "AUTO";
    collatedFrame.counterAxisSizingMode = "FIXED";
    
    // Detect theme
    const backgrounds = figma.currentPage.backgrounds;
    const bgColor = backgrounds && backgrounds[0] ? backgrounds[0].color : null;
    const isLightTheme = !bgColor || (bgColor.r + bgColor.g + bgColor.b) / 3 > 0.5;
    
    if (!isLightTheme) {
      collatedFrame.fills = [{ type: 'SOLID', color: { r: 0x88/255, g: 0x88/255, b: 0x88/255 } }];
    }
    
    // Create header
    const header = figma.createText();
    const headerCommentWord = comments.length === 1 ? 'comment' : 'comments';
    header.characters = `${comments.length} ${headerCommentWord} as of ${new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })}`;
    header.fontName = { family: "Inter", style: "Medium" };
    header.fontSize = 14;
    header.fills = isLightTheme ? 
      [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
      [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    header.textAutoResize = "WIDTH_AND_HEIGHT";
    
    collatedFrame.appendChild(header);
    
    // Add comments
    for (const comment of comments) {
      const isChecked = comment.resolved;
      
      // Create comment container with horizontal auto-layout
      const commentContainer = figma.createFrame();
      commentContainer.name = "Comment";
      commentContainer.fills = [];
      commentContainer.layoutMode = "HORIZONTAL";
      commentContainer.paddingTop = 0;
      commentContainer.paddingBottom = 0;
      commentContainer.paddingLeft = 0;
      commentContainer.paddingRight = 0;
      commentContainer.itemSpacing = 10;
      commentContainer.primaryAxisSizingMode = "AUTO";
      commentContainer.counterAxisSizingMode = "AUTO";
      commentContainer.primaryAxisAlignItems = "MIN";
      commentContainer.counterAxisAlignItems = "MIN";
      
      // Create checkbox
      const checkbox = await createCheckboxComponent(isChecked, isLightTheme);
      checkbox.setPluginData('comment-id', comment.id);
      checkbox.setPluginData('is-comment-checkbox', 'true');
      commentContainer.appendChild(checkbox);
      
      // Create text container with vertical auto-layout
      const textContainer = figma.createFrame();
      textContainer.name = "Text";
      textContainer.fills = [];
      textContainer.layoutMode = "VERTICAL";
      textContainer.paddingTop = 0;
      textContainer.paddingBottom = 0;
      textContainer.paddingLeft = 0;
      textContainer.paddingRight = 0;
      textContainer.itemSpacing = 3;
      textContainer.primaryAxisSizingMode = "AUTO";
      textContainer.counterAxisSizingMode = "FIXED";
      textContainer.primaryAxisAlignItems = "MIN";
      textContainer.counterAxisAlignItems = "MIN";
      
      // Add text container to comment container first
      commentContainer.appendChild(textContainer);
      
      // Now set layout sizing after adding to parent
      textContainer.layoutSizingHorizontal = "FILL";
      
      // Create comment text (first line - comment content)
      const commentText = figma.createText();
      commentText.characters = comment.text;
      commentText.fontName = { family: "Inter", style: "Regular" };
      commentText.fontSize = 12;
      commentText.fills = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
        [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      commentText.textAutoResize = "HEIGHT";
      
      textContainer.appendChild(commentText);
      
      // Set layout sizing after adding to parent
      commentText.layoutSizingHorizontal = "FILL";
      
      // Create author and timestamp text (second line - smaller font)
      const metaText = figma.createText();
      metaText.characters = `${comment.author}, ${comment.timestamp}`;
      metaText.fontName = { family: "Inter", style: "Regular" };
      metaText.fontSize = 8; // 2px smaller than comment text
      metaText.fills = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }] : 
        [{ type: 'SOLID', color: { r: 0.7, g: 0.7, b: 0.7 } }];
      metaText.textAutoResize = "WIDTH_AND_HEIGHT";
      
      textContainer.appendChild(metaText);
      
      collatedFrame.appendChild(commentContainer);
      
      // Set layout sizing after adding to parent
      commentContainer.layoutSizingHorizontal = "FILL";
    }
    
    // Set frame size with minimum width of 350px and maximum width of 450px
    const frameWidth = Math.min(450, Math.max(350, 400));
    collatedFrame.resize(frameWidth, collatedFrame.height);
    
    // Position at top left of canvas, aligned with top-most element
    const position = findCanvasPosition(collatedFrame);
    collatedFrame.x = position.x;
    collatedFrame.y = position.y;
    
    // Show the new frame in viewport
    figma.viewport.scrollAndZoomIntoView([collatedFrame]);
    
    const notificationCommentWord = comments.length === 1 ? 'comment' : 'comments';
    figma.notify(`Created canvas comment collation with ${comments.length} unresolved ${notificationCommentWord}`);
    
  } catch (error) {
    console.error('Error collating canvas comments:', error);
    figma.notify('Error creating canvas comment collation: ' + error.message);
  }
}

// Find position for canvas comments frame
function findCanvasPosition(collatedFrame) {
  const allNodes = figma.currentPage.findAll(node => 
    node.type === 'FRAME' || 
    node.type === 'GROUP' || 
    node.type === 'TEXT' ||
    node.type === 'RECTANGLE' ||
    node.type === 'ELLIPSE' ||
    node.type === 'POLYGON' ||
    node.type === 'STAR' ||
    node.type === 'VECTOR' ||
    node.type === 'COMPONENT' ||
    node.type === 'INSTANCE'
  );
  
  if (allNodes.length === 0) {
    return { x: 0, y: 0 };
  }
  
  // Find the top-most element
  let topMostY = allNodes[0].y;
  let leftMostX = allNodes[0].x;
  
  allNodes.forEach(node => {
    if (node.y < topMostY) {
      topMostY = node.y;
    }
    if (node.x < leftMostX) {
      leftMostX = node.x;
    }
  });
  
  // Position above the top-most element with some spacing
  return {
    x: leftMostX,
    y: topMostY - collatedFrame.height - 80
  };
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
    const allComments = await fetchCommentsForNode(selectedFrame);
    
    // Show only unresolved comments in the collated frame
    const comments = allComments.filter(comment => !comment.resolved);
    
    if (comments.length === 0) {
      figma.notify("No unresolved comments found for this frame");
      return;
    }
    
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    
    // Create collated frame with auto-layout
    const collatedFrame = figma.createFrame();
    collatedFrame.name = `${selectedFrame.name} - Comments`;
    collatedFrame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    
    // Set up auto-layout
    collatedFrame.layoutMode = "VERTICAL";
    collatedFrame.paddingTop = 20;
    collatedFrame.paddingBottom = 20;
    collatedFrame.paddingLeft = 20;
    collatedFrame.paddingRight = 20;
    collatedFrame.itemSpacing = 16;
    collatedFrame.primaryAxisSizingMode = "AUTO";
    collatedFrame.counterAxisSizingMode = "FIXED";
    
    // Detect theme
    const backgrounds = figma.currentPage.backgrounds;
    const bgColor = backgrounds && backgrounds[0] ? backgrounds[0].color : null;
    const isLightTheme = !bgColor || (bgColor.r + bgColor.g + bgColor.b) / 3 > 0.5;
    
    if (!isLightTheme) {
      collatedFrame.fills = [{ type: 'SOLID', color: { r: 0x88/255, g: 0x88/255, b: 0x88/255 } }];
    }
    
    // Create header
    const header = figma.createText();
    const frameHeaderCommentWord = comments.length === 1 ? 'comment' : 'comments';
    header.characters = `${comments.length} ${frameHeaderCommentWord} as of ${new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })}`;
    header.fontName = { family: "Inter", style: "Medium" };
    header.fontSize = 14;
    header.fills = isLightTheme ? 
      [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
      [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
    header.textAutoResize = "WIDTH_AND_HEIGHT";
    
    collatedFrame.appendChild(header);
    
    // Add comments
    for (const comment of comments) {
      const isChecked = comment.resolved;
      
      // Create comment container with horizontal auto-layout
      const commentContainer = figma.createFrame();
      commentContainer.name = "Comment";
      commentContainer.fills = [];
      commentContainer.layoutMode = "HORIZONTAL";
      commentContainer.paddingTop = 0;
      commentContainer.paddingBottom = 0;
      commentContainer.paddingLeft = 0;
      commentContainer.paddingRight = 0;
      commentContainer.itemSpacing = 10;
      commentContainer.primaryAxisSizingMode = "AUTO";
      commentContainer.counterAxisSizingMode = "AUTO";
      commentContainer.primaryAxisAlignItems = "MIN";
      commentContainer.counterAxisAlignItems = "MIN";
      
      // Create checkbox
      const checkbox = await createCheckboxComponent(isChecked, isLightTheme);
      checkbox.setPluginData('comment-id', comment.id);
      checkbox.setPluginData('is-comment-checkbox', 'true');
      commentContainer.appendChild(checkbox);
      
      // Create text container with vertical auto-layout
      const textContainer = figma.createFrame();
      textContainer.name = "Text";
      textContainer.fills = [];
      textContainer.layoutMode = "VERTICAL";
      textContainer.paddingTop = 0;
      textContainer.paddingBottom = 0;
      textContainer.paddingLeft = 0;
      textContainer.paddingRight = 0;
      textContainer.itemSpacing = 3;
      textContainer.primaryAxisSizingMode = "AUTO";
      textContainer.counterAxisSizingMode = "FIXED";
      textContainer.primaryAxisAlignItems = "MIN";
      textContainer.counterAxisAlignItems = "MIN";
      
      // Add text container to comment container first
      commentContainer.appendChild(textContainer);
      
      // Now set layout sizing after adding to parent
      textContainer.layoutSizingHorizontal = "FILL";
      
      // Create comment text (first line - comment content)
      const commentText = figma.createText();
      commentText.characters = comment.text;
      commentText.fontName = { family: "Inter", style: "Regular" };
      commentText.fontSize = 12;
      commentText.fills = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }] : 
        [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      commentText.textAutoResize = "HEIGHT";
      
      textContainer.appendChild(commentText);
      
      // Set layout sizing after adding to parent
      commentText.layoutSizingHorizontal = "FILL";
      
      // Create author and timestamp text (second line - smaller font)
      const metaText = figma.createText();
      metaText.characters = `${comment.author}, ${comment.timestamp}`;
      metaText.fontName = { family: "Inter", style: "Regular" };
      metaText.fontSize = 8; // 2px smaller than comment text
      metaText.fills = isLightTheme ? 
        [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }] : 
        [{ type: 'SOLID', color: { r: 0.7, g: 0.7, b: 0.7 } }];
      metaText.textAutoResize = "WIDTH_AND_HEIGHT";
      
      textContainer.appendChild(metaText);
      
      collatedFrame.appendChild(commentContainer);
      
      // Set layout sizing after adding to parent
      commentContainer.layoutSizingHorizontal = "FILL";
    }
    
    // Set frame size with minimum width of 350px and maximum width of 450px
    const frameWidth = Math.min(450, Math.max(350, selectedFrame.width));
    collatedFrame.resize(frameWidth, collatedFrame.height);
    
    // Intelligent positioning to avoid overlapping existing frames
    const position = findOptimalPosition(selectedFrame, collatedFrame);
    collatedFrame.x = position.x;
    collatedFrame.y = position.y;
    
    // Keep the original frame selected but show the new frame in viewport
    figma.currentPage.selection = [selectedFrame];
    figma.viewport.scrollAndZoomIntoView([collatedFrame]);
    
    const frameNotificationCommentWord = comments.length === 1 ? 'comment' : 'comments';
    figma.notify(`Created comment collation with ${comments.length} unresolved ${frameNotificationCommentWord}`);
    
  } catch (error) {
    console.error('Error collating comments:', error);
    figma.notify('Error creating comment collation: ' + error.message);
  }
}

// Find optimal position for the collated frame to avoid overlapping existing frames
function findOptimalPosition(selectedFrame, collatedFrame) {
  const spacing = 80;
  const allFrames = figma.currentPage.findAll(node => node.type === 'FRAME' && node !== selectedFrame);
  
  // Helper function to check if two rectangles overlap
  function rectanglesOverlap(rect1, rect2) {
    return !(rect1.x + rect1.width <= rect2.x || 
             rect2.x + rect2.width <= rect1.x || 
             rect1.y + rect1.height <= rect2.y || 
             rect2.y + rect2.height <= rect1.y);
  }
  
  // Helper function to check if a position is clear of all frames
  function isPositionClear(x, y) {
    const testRect = { x, y, width: collatedFrame.width, height: collatedFrame.height };
    return !allFrames.some(frame => {
      const frameRect = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
      return rectanglesOverlap(testRect, frameRect);
    });
  }
  
  // Try positions in order of priority: top, bottom, left, right
  const positions = [
    // Top - align left with selected frame
    { 
      x: selectedFrame.x, 
      y: selectedFrame.y - collatedFrame.height - spacing,
      name: 'top'
    },
    // Bottom - align left with selected frame
    { 
      x: selectedFrame.x, 
      y: selectedFrame.y + selectedFrame.height + spacing,
      name: 'bottom'
    },
    // Left - align top with selected frame
    { 
      x: selectedFrame.x - collatedFrame.width - spacing, 
      y: selectedFrame.y,
      name: 'left'
    },
    // Right - align top with selected frame
    { 
      x: selectedFrame.x + selectedFrame.width + spacing, 
      y: selectedFrame.y,
      name: 'right'
    }
  ];
  
  // Find the first clear position
  for (const position of positions) {
    if (isPositionClear(position.x, position.y)) {
      console.log(`Positioned collated frame to the ${position.name} of selected frame`);
      return { x: position.x, y: position.y };
    }
  }
  
  // If no clear position found, place above (even if it overlaps)
  console.log('No clear position found, defaulting to top position');
  return { x: selectedFrame.x, y: selectedFrame.y - collatedFrame.height - spacing };
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'close') {
    figma.closePlugin();
  } else if (msg.type === 'add-frame-comments') {
    await collateCommentsToCanvas();
  } else if (msg.type === 'add-canvas-comments') {
    await collateCanvasCommentsToCanvas();
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
  } else if (msg.type === 'sync-canvas-comments') {
    await syncCanvasComments(msg.operationId);
  } else if (msg.type === 'sync-frame-comments') {
    await syncFrameComments(msg.operationId);
  } else if (msg.type === 'logout') {
    sessionData.token = null;
    sessionData.user = null;
    figma.ui.postMessage({ type: 'logged-out' });
    checkSelectionAndSendComments();
  }
};

// Handle selection change
figma.on('selectionchange', () => {
  // Check if a checkbox was selected and toggle it
  const selection = figma.currentPage.selection;
  if (selection.length === 1) {
    const selectedNode = selection[0];
    if (selectedNode.getPluginData('is-comment-checkbox') === 'true') {
      // Auto-toggle the checkbox and then deselect it
      toggleCheckbox(selectedNode.id).then(() => {
        // Keep the original frame selected if it exists
        const allFrames = figma.currentPage.findAll(node => 
          node.type === 'FRAME' && 
          !node.name.includes('- Comments') &&
          node.getPluginData('is-comment-checkbox') !== 'true'
        );
        if (allFrames.length > 0) {
          // Try to find the frame the user was working with
          figma.currentPage.selection = [];
        }
      });
      return; // Don't update comments when clicking checkbox
    }
  }
  
  checkSelectionAndSendComments();
});

// Initialize plugin
initializePlugin(); 