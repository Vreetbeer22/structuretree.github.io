let root;
let allNodesData = [];
let nodesMap = {};
let isSearchMode = false;
let searchResults = [];
let currentSearchIndex = 0;
let g;
let svg;
let zoom;
let width = 1200;
let height = 800;

// Load the JSON file with all node data
fetch("confluence_elements.json")
  .then((res) => res.json())
  .then((nodesData) => {
    allNodesData = nodesData;
    // Create a lookup map for quick access to nodes by name
    nodesMap = Object.fromEntries(
      nodesData.map((n) => [normalizeName(n.name), n])
    );

    const treeData = buildTreeFromJSON(nodesData);
    renderTree(treeData);
  })
  .catch((err) => console.error("Can't load the json:", err));

// Normalize names by removing extra info and converting to lowercase
function normalizeName(name) {
  return name.split("=")[0].trim().toLowerCase();
}

// Build the main tree structure from JSON data
function buildTreeFromJSON(nodesData) {
  // Find the root node (one with "none" as parent)
  const rootNode = nodesData.find((n) =>
    n.parents.some((p) => p.toLowerCase() === "none")
  );
  if (!rootNode) throw new Error("No root node found!");

  // Track the first depth where each node appears to prevent duplicates
  const firstDepths = {};
  
  function scanDepths(node, depth = 0, path = []) {
    const prefix = normalizeName(node.name);
    
    // Avoid circular references
    if (path.includes(prefix)) return;
    
    // Record the shallowest depth for this node
    if (firstDepths[prefix] === undefined || depth < firstDepths[prefix]) {
      firstDepths[prefix] = depth;
    }
    
    if (node.children) {
      node.children.forEach((childName) => {
        const child = nodesMap[normalizeName(childName)];
        if (child) {
          scanDepths(child, depth + 1, [...path, prefix]);
        }
      });
    }
  }
  
  scanDepths(rootNode, 0, []);
  
  console.log("First depths:", firstDepths);

  function build(node, depth = 0, path = []) {
    const prefix = normalizeName(node.name);
    
    // Check for circular reference
    if (path.includes(prefix)) {
      return {
        name: node.name,
        children: [],
        blocked: true,
        reason: "circular",
        depth: depth
      };
    }

    // Only show node at its first appearance depth
    const isAtFirstDepth = firstDepths[prefix] === depth;
    const blocked = !isAtFirstDepth;

    console.log(`${node.name} at depth ${depth}, first depth: ${firstDepths[prefix]}, blocked: ${blocked}`);

    // Build children only if at first depth
    const children = isAtFirstDepth && node.children
      ? node.children
          .map((c) => nodesMap[normalizeName(c)])
          .filter(Boolean)
          .map((child) => build(child, depth + 1, [...path, prefix]))
      : [];

    return {
      name: node.name,
      children,
      blocked,
      reason: blocked ? "duplicate" : null,
      depth: depth,
      isAtFirstDepth
    };
  }

  return build(rootNode, 0, []);
}

// Build a butterfly tree centered on a specific node (for search mode)
function buildTreeFromNode(targetNode) {
  const targetName = normalizeName(targetNode.name);
  
  // Build tree going UP (parents) from a node
  function buildParentTree(node, depth = 0, visited = new Set()) {
    const nodeName = normalizeName(node.name);
    
    if (visited.has(nodeName)) {
      return {
        name: node.name,
        children: [],
        blocked: true,
        reason: "circular",
        depth: depth
      };
    }
    
    const newVisited = new Set(visited);
    newVisited.add(nodeName);
    
    let children = [];
    
    // Add this node's parents as children (to go upward)
    if (node.parents && node.parents.length > 0) {
      children = node.parents
        .filter(p => p.toLowerCase() !== "none")
        .map(parentName => {
          const parent = nodesMap[normalizeName(parentName)];
          if (!parent) return null;
          const parentTree = buildParentTree(parent, depth + 1, newVisited);
          return parentTree;
        })
        .filter(Boolean);
    }
    
    return {
      name: node.name,
      children,
      blocked: false,
      reason: null,
      depth: depth,
      isParent: true
    };
  }
  
  // Build tree going DOWN (children) from a node
  function buildChildTree(node, depth = 0, visited = new Set()) {
    const nodeName = normalizeName(node.name);
    
    if (visited.has(nodeName)) {
      return {
        name: node.name,
        children: [],
        blocked: true,
        reason: "circular",
        depth: depth
      };
    }
    
    const newVisited = new Set(visited);
    newVisited.add(nodeName);
    
    let children = [];
    
    if (node.children && node.children.length > 0) {
      children = node.children
        .map(childName => {
          const child = nodesMap[normalizeName(childName)];
          if (!child) return null;
          const childTree = buildChildTree(child, depth + 1, newVisited);
          return childTree;
        })
        .filter(Boolean);
    }
    
    return {
      name: node.name,
      children,
      blocked: false,
      reason: null,
      depth: depth,
      isChild: true
    };
  }
  
  // Build butterfly tree with target at center
  const targetTree = {
    name: targetNode.name,
    children: [],
    blocked: false,
    reason: null,
    depth: 0,
    isTarget: true
  };
  
  // Add parents going up
  if (targetNode.parents && targetNode.parents.length > 0) {
    const parents = targetNode.parents
      .filter(p => p.toLowerCase() !== "none")
      .map(parentName => {
        const parent = nodesMap[normalizeName(parentName)];
        if (!parent) return null;
        const parentTree = buildParentTree(parent, 1, new Set([targetName]));
        return parentTree;
      })
      .filter(Boolean);
    targetTree.children = targetTree.children.concat(parents);
  }
  
  // Add children going down
  if (targetNode.children && targetNode.children.length > 0) {
    const children = targetNode.children
      .map(childName => {
        const child = nodesMap[normalizeName(childName)];
        if (!child) return null;
        const childTree = buildChildTree(child, 1, new Set([targetName]));
        return childTree;
      })
      .filter(Boolean);
    targetTree.children = targetTree.children.concat(children);
  }
  
  return targetTree;
}

// Main function to render the tree visualization
function renderTree(treeData) {
  const container = d3.select("#tree-container");
  container.selectAll("*").remove();

  // Create SVG canvas
  svg = container
    .append("svg")
    .attr("width", "100%")
    .attr("height", "100%");
  g = svg.append("g");

  // Set initial zoom and position
  const initialTransform = d3.zoomIdentity
    .translate(width / 2, 50)
    .scale(1);

  // Configure zoom behavior
  zoom = d3
    .zoom()
    .scaleExtent([0.4, 3])
    .on("zoom", (event) => g.attr("transform", event.transform));
  
  svg.call(zoom);
  svg.call(zoom.transform, initialTransform);

  // Helper function to center the tree view
  function centerTree() {
    svg.transition()
      .duration(750)
      .call(zoom.transform, initialTransform);
  }

  // Node dimensions
  const rectHeight = 30;
  const rectPadding = 10;
  
  // Check if this is a search tree to determine layout
  const isSearchTree = treeData.isTarget || 
    (treeData.children && treeData.children.some(c => c.isTarget || c.isParent || c.isChild));
  
  const treeLayout = d3.tree().nodeSize([180, 70]);
  
  root = d3.hierarchy(treeData);

  // Store node positions for smooth transitions
  let nodeIdCounter = 0;
  root.descendants().forEach((d) => {
    d.x0 = d.x;
    d.y0 = d.y;
    // Assign permanent IDs based on node path
    d.id = d.data.name + '_' + (d.parent ? d.parent.id : 'root');
  });

  // Initially collapse all nodes
  root.descendants().forEach((d) => {
    if (d.children && d.children.length) {
      d._children = d.children;
      d.children = null;
    }
  });

  // Expand to appropriate levels based on whether it's a search or normal tree
  function expandLevels(node, level = 0, max = 3) {
    if (node._children && level < max) {
      node.children = node._children;
      node._children = null;
      if (node.children) {
        node.children.forEach((c) => expandLevels(c, level + 1, max));
      }
    }
  }
  
  // Store whether this is a search tree for later use
  const isSearchTreeView = isSearchTree;
  
  if (isSearchTreeView) {
    // For search: only expand first level (direct connections)
    if (root._children) {
      root.children = root._children;
      root._children = null;
    }
  } else {
    // For normal tree: expand only 2 levels
    expandLevels(root, 0, 2);
  }

  update(root);

  // Main update function that redraws the tree
  function update(source) {
    // Calculate new tree layout
    treeLayout(root);
    
    // Properly propagate parent/child markers through the tree
    function propagateMarkers(node) {
      if (node.children) {
        node.children.forEach(child => {
          // Inherit parent/child status from parent node
          if (node.data.isParent && !child.data.isChild && !child.data.isTarget) {
            child.data.isParent = true;
          }
          if (node.data.isChild && !child.data.isParent && !child.data.isTarget) {
            child.data.isChild = true;
          }
          propagateMarkers(child);
        });
      }
      if (node._children) {
        node._children.forEach(child => {
          // Inherit parent/child status from parent node
          if (node.data.isParent && !child.data.isChild && !child.data.isTarget) {
            child.data.isParent = true;
          }
          if (node.data.isChild && !child.data.isParent && !child.data.isTarget) {
            child.data.isChild = true;
          }
          propagateMarkers(child);
        });
      }
    }
    
    // Apply marker propagation in search mode
    if (isSearchTreeView) {
      propagateMarkers(root);
    }
    
    // Adjust positions for butterfly layout in search mode
    if (isSearchTreeView) {
      // Helper function to calculate the width of a subtree
      function getSubtreeWidth(node) {
        if (!node.children || node.children.length === 0) {
          return 180; // Width for a single node
        }
        
        // Sum up the widths of all children
        let totalWidth = 0;
        node.children.forEach(child => {
          totalWidth += getSubtreeWidth(child);
        });
        
        return Math.max(180, totalWidth);
      }
      
      // Helper function to position nodes in a subtree
      function positionSubtree(node, startX, isUpward) {
        if (!node.children || node.children.length === 0) {
          node.x = startX;
          node.y = isUpward ? -Math.abs(node.y) : Math.abs(node.y);
          return 180;
        }
        
        // Calculate widths for each child
        const childWidths = node.children.map(child => getSubtreeWidth(child));
        const totalWidth = childWidths.reduce((sum, w) => sum + w, 0);
        
        // Position children from left to right
        let currentX = startX;
        node.children.forEach((child, i) => {
          const childWidth = childWidths[i];
          const childCenterX = currentX + childWidth / 2;
          
          positionSubtree(child, currentX, isUpward);
          child.x = childCenterX;
          child.y = isUpward ? -Math.abs(child.y) : Math.abs(child.y);
          
          currentX += childWidth;
        });
        
        // Center the parent over its children
        node.x = startX + totalWidth / 2;
        node.y = isUpward ? -Math.abs(node.y) : Math.abs(node.y);
        
        return totalWidth;
      }
      
      // Separate parent branches from child branches at root level
      const rootChildren = root.children || [];
      const parentBranches = rootChildren.filter(c => c.data.isParent);
      const childBranches = rootChildren.filter(c => c.data.isChild);
      
      // Calculate widths for parent and child branches
      const parentWidths = parentBranches.map(p => getSubtreeWidth(p));
      const childWidths = childBranches.map(c => getSubtreeWidth(c));
      const totalParentWidth = parentWidths.reduce((sum, w) => sum + w, 0);
      const totalChildWidth = childWidths.reduce((sum, w) => sum + w, 0);
      
      // Center the root
      root.x = 0;
      root.y = 0;
      
      // Position parent branches (going UP)
      if (parentBranches.length > 0) {
        let currentX = -totalParentWidth / 2;
        parentBranches.forEach((parent, i) => {
          positionSubtree(parent, currentX, true);
          parent.x = currentX + parentWidths[i] / 2;
          parent.y = -Math.abs(parent.y);
          currentX += parentWidths[i];
        });
      }
      
      // Position child branches (going DOWN)
      if (childBranches.length > 0) {
        let currentX = -totalChildWidth / 2;
        childBranches.forEach((child, i) => {
          positionSubtree(child, currentX, false);
          child.x = currentX + childWidths[i] / 2;
          child.y = Math.abs(child.y);
          currentX += childWidths[i];
        });
      }
    }

    const duration = 300;
    const nodes = root.descendants();
    const links = root.links();

    // Initialize positions for ALL nodes before any animations
    nodes.forEach(d => {
      // If node has never been positioned, set initial position
      if (d.x0 === undefined || d.y0 === undefined) {
        if (d.parent && d.parent.x0 !== undefined && d.parent.y0 !== undefined) {
          // New node starts at parent's last position
          d.x0 = d.parent.x0;
          d.y0 = d.parent.y0;
        } else {
          // Fallback to source position
          d.x0 = source.x0 || source.x || 0;
          d.y0 = source.y0 || source.y || 0;
        }
      }
    });

    // Update the links (connections between nodes)
    const link = g.selectAll(".link")
      .data(links, d => {
        // Create stable unique key for each link using node IDs
        return `link-${d.source.id}-${d.target.id}`;
      });

    // Enter new links at the parent's previous position
    const linkEnter = link.enter()
      .insert("path", "g")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", "#999")
      .attr("stroke-width", 1.5)
      .attr("d", d => {
        // Start from the parent node's position
        const o = {
          x: d.source.x0 !== undefined ? d.source.x0 : source.x0,
          y: d.source.y0 !== undefined ? d.source.y0 : source.y0
        };
        return diagonal(o, o, d.target.data.isParent);
      });

    // Transition links to their new position
    const linkUpdate = linkEnter.merge(link);
    linkUpdate.transition()
      .duration(duration)
      .attr("d", d => diagonal(d.source, d.target, d.target.data.isParent));

    // Transition exiting links to the parent's new position
    link.exit()
      .transition()
      .duration(duration)
      .attr("d", d => {
        // Collapse to the source node's new position
        const o = {
          x: d.source.x !== undefined ? d.source.x : source.x,
          y: d.source.y !== undefined ? d.source.y : source.y
        };
        return diagonal(o, o, d.target.data.isParent);
      })
      .remove();

    // Update the nodes
    const node = g.selectAll(".node")
      .data(nodes, d => d.id);

    // Enter new nodes at the parent's previous position
    const nodeEnter = node.enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", d => {
        // Start from parent's position if available
        const startX = d.parent && d.parent.x0 !== undefined ? d.parent.x0 : source.x0;
        const startY = d.parent && d.parent.y0 !== undefined ? d.parent.y0 : source.y0;
        return `translate(${startX},${startY})`;
      })
      .style("cursor", d => d.data.blocked ? "not-allowed" : "pointer")
      .on("click", (event, d) => {
        if (d.data.blocked) return;
        
        // Toggle children on click
        if (d.children) {
          d._children = d.children;
          d.children = null;
        } else if (d._children) {
          d.children = d._children;
          d._children = null;
        }
        update(d);
      });

    // Add rectangle for each node
    nodeEnter.append("rect")
      .attr("class", "node-rect")
      .attr("width", d => Math.max(60, d.data.name.length * 7 + rectPadding * 2))
      .attr("height", rectHeight)
      .attr("x", d => -(Math.max(60, d.data.name.length * 7 + rectPadding * 2) / 2))
      .attr("y", -rectHeight / 2)
      .attr("rx", 4)
      .attr("ry", 4)
      .attr("fill", d => {
        if (d.data.blocked) return "#FFB3B3";
        if (d._children) return "#B3D9FF"; // Can expand
        if (!d.children && !d._children) return "#BEC0C1"; // Leaf node (no children)
        return "#ffffff"; // Expanded
      })
      .attr("stroke", d => {
        if (d.data.blocked) return "#DA4646";
        if (d._children) return "#0043B6"; // Can expand
        if (!d.children && !d._children) return "#707072"; // Leaf node
        return "#666"; // Expanded
      })
      .attr("stroke-width", 1);

    // Add text label for each node
    nodeEnter.append("text")
      .attr("dy", 4)
      .attr("text-anchor", "middle")
      .style("pointer-events", "none")
      .style("font-size", "11px")
      .style("font-family", "Arial, sans-serif")
      .text(d => d.data.name);

    // Update existing nodes
    const nodeUpdate = nodeEnter.merge(node);
    
    // Transition nodes to their new position
    nodeUpdate.transition()
      .duration(duration)
      .attr("transform", d => `translate(${d.x},${d.y})`);

    // Update node colors based on collapsed state
    nodeUpdate.select(".node-rect")
      .attr("fill", d => {
        if (d.data.blocked) return "#FFB3B3";
        if (d._children) return "#B3D9FF"; // Can expand
        if (!d.children && !d._children) return "#BEC0C1"; // Leaf node
        return "#ffffff"; // Expanded
      })
      .attr("stroke", d => {
        // Check if this is the search target (must be the root node with isTarget flag)
        if (window.currentSearchTarget && normalizeName(d.data.name) === window.currentSearchTarget && d.data.isTarget) {
          return "#00cc00";
        }
        if (d.data.blocked) return "#DA4646";
        if (d._children) return "#0043B6"; // Can expand
        if (!d.children && !d._children) return "#707072"; // Leaf node
        return "#666"; // Expanded
      })
      .attr("stroke-width", d => {
        // Make search target border thicker (only for the root target node)
        if (window.currentSearchTarget && normalizeName(d.data.name) === window.currentSearchTarget && d.data.isTarget) {
          return 3;
        }
        return 1;
      });

    // Transition exiting nodes to the parent's new position
    node.exit()
      .transition()
      .duration(duration)
      .attr("transform", d => {
        // Collapse to parent's position if available
        const endX = d.parent && d.parent.x !== undefined ? d.parent.x : source.x;
        const endY = d.parent && d.parent.y !== undefined ? d.parent.y : source.y;
        return `translate(${endX},${endY})`;
      })
      .remove();

    // Store new positions for next transition (do this immediately, not after animation)
    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }

  // Helper function to create diagonal links between nodes
  function diagonal(s, d, isParent) {
    if (isParent) {
      // For parent nodes (going up), reverse the connection
      return `M ${s.x} ${s.y - rectHeight / 2}
              C ${s.x} ${(s.y - rectHeight / 2 + d.y + rectHeight / 2) / 2},
                ${d.x} ${(s.y - rectHeight / 2 + d.y + rectHeight / 2) / 2},
                ${d.x} ${d.y + rectHeight / 2}`;
    } else {
      // Normal downward connection for children
      return `M ${s.x} ${s.y + rectHeight / 2}
              C ${s.x} ${(s.y + rectHeight / 2 + d.y - rectHeight / 2) / 2},
                ${d.x} ${(s.y + rectHeight / 2 + d.y - rectHeight / 2) / 2},
                ${d.x} ${d.y - rectHeight / 2}`;
    }
  }

  // Initialize counter for unique node IDs
  let i = 0;

  // Expand all nodes button
  document.getElementById("expandAll").onclick = () => {
    expandAll(root);
    update(root);
  };
  
  // Collapse all nodes button
  document.getElementById("collapseAll").onclick = () => {
    // In search mode, collapse everything (only show root)
    // In normal mode, keep 2 levels visible (root + first children)
    const maxLevel = isSearchTreeView ? 0 : 1;
    collapseAll(root, 0, maxLevel);
    update(root);
    centerTree();
  };

  // Reset tree to initial view
  document.getElementById("resetTree").onclick = () => {
    isSearchMode = false;
    window.currentSearchTarget = null; // Clear search highlight
    const treeData = buildTreeFromJSON(allNodesData);
    renderTree(treeData);
    document.getElementById("resultCount").textContent = "";
    document.getElementById("searchInput").value = "";
  };

  // Recursively expand all nodes
  function expandAll(node) {
    if (node._children) {
      node.children = node._children;
      node._children = null;
    }
    if (node.children) node.children.forEach(expandAll);
  }

  // Recursively collapse nodes beyond a certain level
  function collapseAll(node, level = 0, maxLevel = 1) {
    if (node.children) {
      node.children.forEach((c) => collapseAll(c, level + 1, maxLevel));
    }
    
    if (level > maxLevel && node.children) {
      node._children = node.children;
      node.children = null;
    }
  }

  // Set up search functionality
  const input = document.getElementById("searchInput");
  const button = document.getElementById("searchButton");
  const nextButton = document.getElementById("nextButton");
  const prevButton = document.getElementById("prevButton");

  // Allow Enter key to trigger search
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") button.click();
  });

  // Search button handler
  button.onclick = () => {
    const q = normalizeName(input.value.trim());
    if (!q) return;

    // Find all nodes matching the search query
    searchResults = allNodesData.filter((n) => normalizeName(n.name).includes(q));
    
    if (searchResults.length === 0) {
      document.getElementById("resultCount").textContent = "No results found";
      alert("No matching element found!");
      return;
    }

    currentSearchIndex = 0;
    isSearchMode = true;
    showSearchResult();
  };

  // Navigate to next search result
  nextButton.onclick = () => {
    if (!isSearchMode || searchResults.length === 0) {
      return;
    }
    
    currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
    showSearchResult();
  };

  // Navigate to previous search result
  prevButton.onclick = () => {
    if (!isSearchMode || searchResults.length === 0) return;
    
    currentSearchIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length;
    showSearchResult();
  };

  // Display the current search result
  function showSearchResult() {
    const found = searchResults[currentSearchIndex];
    const subTree = buildTreeFromNode(found);
    
    if (!subTree) {
      alert("Could not build tree for this element");
      return;
    }
    
    // Store the target name globally for highlighting
    window.currentSearchTarget = normalizeName(found.name);
    
    renderTree(subTree);
    
    // Find and highlight the target node after tree is rendered
    setTimeout(() => {
      const targetName = normalizeName(found.name);
      
      // Recursively search for the target node in the tree
      function findTargetNode(node) {
        if (normalizeName(node.data.name) === targetName) {
          return node;
        }
        if (node.children) {
          for (const child of node.children) {
            const result = findTargetNode(child);
            if (result) return result;
          }
        }
        if (node._children) {
          for (const child of node._children) {
            const result = findTargetNode(child);
            if (result) return result;
          }
        }
        return null;
      }
      
      const targetNode = findTargetNode(root);
      
      if (targetNode) {
        // Highlight the target node with green border
        g.selectAll(".node-rect")
          .attr("stroke", (d) => {
            if (normalizeName(d.data.name) === targetName && d.data.isTarget) {
              return "#00cc00";
            }
            return d.data.blocked ? "#DA4646" : (d._children ? "#0043B6" : (!d.children && !d._children ? "#707072" : "#666"));
          })
          .attr("stroke-width", (d) => {
            if (normalizeName(d.data.name) === targetName && d.data.isTarget) {
              return 3;
            }
            return 1;
          });
        
        // Center on target node
        const transform = d3.zoomIdentity
          .translate(width / 2 - targetNode.x, 100 - targetNode.y)
          .scale(1);
        
        svg.transition()
          .duration(750)
          .call(zoom.transform, transform);
      }
    }, 150);
    
    // Update result counter display
    document.getElementById("resultCount").textContent = 
      `Result ${currentSearchIndex + 1} of ${searchResults.length}: ${found.name}`;
  }
}