import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { stableIdKey, shortNodeId, shortUri } from '../identity.js';

// A tree *occurrence* is identified by its expansion path (context key), while
// the underlying node is identified by its stable key. The same node reached
// via multiple paths therefore appears multiple times (each occurrence can be
// expanded on its own) but is badged "shared", and we never re-fetch a node
// already loaded under the same occurrence.
function contextKeyOf(parentContextKey, nodeKey) {
  return parentContextKey ? `${parentContextKey} › ${nodeKey}` : nodeKey;
}

function NodeIcon({ node }) {
  if (node.isMethod) return <span title="方法">⚙️</span>;
  if (node.isVariable) return <span title="变量">📈</span>;
  return <span title="对象">🗂️</span>;
}

function TreeNode({ occurrence, depth, globalSeen, selectedKey, onSelect, onToggle, expandedMap, loadingMap, childrenMap }) {
  const node = occurrence.node;
  const nodeKey = node.key;
  const ck = occurrence.contextKey;
  const expanded = !!expandedMap[ck];
  const loading = !!loadingMap[ck];
  const children = childrenMap[ck] ?? [];
  const isShared = globalSeen.current.has(nodeKey) && globalSeen.current.firstContext[nodeKey] !== ck;
  const expandable = !node.isVariable && !node.isMethod;

  return (
    <div>
      <div className="tree-row" style={{ paddingLeft: depth * 16 + 4 }}>
        <span
          className="twisty"
          onClick={() => expandable && onToggle(occurrence)}
        >
          {expandable ? (expanded ? '▾' : '▸') : '·'}
        </span>
        <span className="node-icon"><NodeIcon node={node} /></span>
        <span
          className={`node-name ${selectedKey === nodeKey ? 'selected' : ''}`}
          onClick={() => onSelect(occurrence)}
          title={node.nodeIdText}
        >
          {node.browseName}
        </span>
        {node.isVariable && <span className="node-badge var">变量</span>}
        {node.isMethod && <span className="node-badge method">方法</span>}
        {isShared && <span className="node-badge shared" title="同一节点经另一条路径到达（引用环/共享节点）">共享/环</span>}
        <span className="node-ns mono">{shortUri(node.stableId.namespaceUri)}:{shortNodeId(node.stableId)}</span>
      </div>
      {loading && <div className="spinner" style={{ paddingLeft: depth * 16 + 22 }}>加载中…</div>}
      {expanded && children.map((child) => (
        <TreeNode
          key={child.contextKey}
          occurrence={child}
          depth={depth + 1}
          globalSeen={globalSeen}
          selectedKey={selectedKey}
          onSelect={onSelect}
          onToggle={onToggle}
          expandedMap={expandedMap}
          loadingMap={loadingMap}
          childrenMap={childrenMap}
        />
      ))}
    </div>
  );
}

const ROOT_STABLE = { namespaceUri: 'http://opcfoundation.org/UA/', identifierType: 'numeric', identifier: 84 };

export default function AddressTree({ onSelect, selectedNode, refreshSignal }) {
  const rootNode = {
    key: stableIdKey(ROOT_STABLE),
    stableId: ROOT_STABLE,
    browseName: 'Root',
    displayName: 'Root',
    isVariable: false,
    isMethod: false,
    nodeIdText: 'ns=0;i=84',
  };
  const rootOccurrence = { node: rootNode, contextKey: rootNode.key, path: [] };
  const [expandedMap, setExpandedMap] = useState({ [rootNode.key]: true });
  const [loadingMap, setLoadingMap] = useState({});
  const [childrenMap, setChildrenMap] = useState({});
  const [error, setError] = useState(null);

  // nodeKey -> first contextKey where it appeared; plus a set of every node.
  const globalSeen = {
    current: new Set(Object.keys(childrenMap).length ? [] : []),
    firstContext: {},
  };

  const loadChildren = useCallback(async (occurrence) => {
    const ck = occurrence.contextKey;
    setLoadingMap((m) => ({ ...m, [ck]: true }));
    setError(null);
    try {
      const result = await api.browse(occurrence.node.stableId);
      if (result.mismatch) {
        setError(`${occurrence.node.browseName}: ${result.mismatch.reason}`);
        setChildrenMap((m) => ({ ...m, [ck]: [] }));
      } else {
        const occurrences = result.references.map((ref) => {
          const childNodeKey = ref.key;
          const childContext = contextKeyOf(ck, childNodeKey);
          return {
            node: ref,
            contextKey: childContext,
            path: [...occurrence.path, { key: childNodeKey, browseName: ref.browseName, referenceType: ref.referenceType }],
          };
        });
        setChildrenMap((m) => ({ ...m, [ck]: occurrences }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingMap((m) => ({ ...m, [ck]: false }));
    }
  }, []);

  // load the root level once (and whenever a reconnect refresh is requested)
  useEffect(() => {
    loadChildren(rootOccurrence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const handleToggle = useCallback((occurrence) => {
    const ck = occurrence.contextKey;
    setExpandedMap((m) => {
      const next = { ...m, [ck]: !m[ck] };
      if (next[ck] && !childrenMap[ck]) loadChildren(occurrence);
      return next;
    });
  }, [childrenMap, loadChildren]);

  // Build the global seen-index from loaded occurrences.
  const seenSet = new Set();
  const firstContext = {};
  for (const occurrences of Object.values(childrenMap)) {
    for (const occ of occurrences) {
      if (!seenSet.has(occ.node.key)) {
        seenSet.add(occ.node.key);
        firstContext[occ.node.key] = occ.contextKey;
      }
    }
  }
  const seenIndex = { current: seenSet, firstContext };

  return (
    <div className="tree">
      {error && <div className="banner error">{error}</div>}
      <TreeNode
        occurrence={rootOccurrence}
        depth={0}
        globalSeen={seenIndex}
        selectedKey={selectedNode?.key}
        onSelect={onSelect}
        onToggle={handleToggle}
        expandedMap={expandedMap}
        loadingMap={loadingMap}
        childrenMap={childrenMap}
      />
    </div>
  );
}
