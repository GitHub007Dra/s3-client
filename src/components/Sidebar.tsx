import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { ConnectionItem, Bucket } from '../shared/types';
import { 
  setCurrentConnection, 
  addFolder, 
  deleteItem, 
  updateFolder,
  moveItem 
} from '../renderer/store/slices/connectionsSlice';
import { setCurrentBucket, setFiles, setCurrentPath, setBuckets } from '../renderer/store/slices/filesSlice';
import { S3Service } from '../renderer/services/s3Service';
import { 
  HardDrive, 
  ChevronRight, 
  Folder,
  FolderOpen,
  Plus,
  Edit2,
  Trash2,
  Database,
  GripVertical
} from 'lucide-react';

interface SidebarProps {
  onAddConnection: (parentId: string | null) => void;
  onEditConnection: (item: ConnectionItem) => void;
  onConnectionSelect: (connectionId: string) => void;
  onBucketSelect: (bucket: Bucket) => void;
}

// 右键菜单类型
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  targetId: string | null;
  targetType: 'blank' | 'folder' | 'connection';
}

// 重命名状态
interface RenamingState {
  id: string;
  name: string;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  onAddConnection,
  onEditConnection,
  onConnectionSelect,
  onBucketSelect 
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const items = useSelector((state: RootState) => state.connections.items);
  const currentConnectionId = useSelector((state: RootState) => state.connections.currentConnectionId);
  const buckets = useSelector((state: RootState) => state.files.buckets);
  const currentBucket = useSelector((state: RootState) => state.files.currentBucket);
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    targetId: null,
    targetType: 'blank'
  });
  const [renaming, setRenaming] = useState<RenamingState | null>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);
  
  const sidebarRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦重命名输入框
  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  // 获取根级别项目
  const rootItems = useMemo(() => {
    return items.filter(item => item.parentId === null);
  }, [items]);

  // 获取子项目
  const getChildren = useCallback((parentId: string) => {
    return items.filter(item => item.parentId === parentId);
  }, [items]);

  // 切换文件夹展开状态
  const toggleFolder = (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation();
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // 选择连接
  const handleSelectConnection = async (item: ConnectionItem) => {
    if (!item.connection || currentConnectionId === item.id) return;
    
    setIsLoading(true);
    setErrorMessage(null);
    
    dispatch(setCurrentConnection(item.id));
    onConnectionSelect(item.id);
    
    try {
      const s3Service = new S3Service(dispatch);
      await s3Service.connect(item.connection);
      const s3Buckets = await s3Service.listBuckets(item.id);
      
      if (!s3Buckets || s3Buckets.length === 0) {
        dispatch(setBuckets([]));
      } else {
        const buckets: Bucket[] = s3Buckets.map((b, index) => ({
          id: `${item.id}-${b.name}-${index}`,
          name: b.name,
          region: b.region,
          creationDate: b.creationDate,
        }));
        dispatch(setBuckets(buckets));
      }
      
      dispatch(setCurrentBucket(null));
      dispatch(setFiles([]));
      dispatch(setCurrentPath(''));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage('连接失败: ' + errorMsg);
      dispatch(setBuckets([]));
    } finally {
      setIsLoading(false);
    }
  };

  // 选择存储桶
  const handleSelectBucket = (bucket: Bucket) => {
    dispatch(setCurrentBucket(bucket));
    dispatch(setCurrentPath(''));
    dispatch(setFiles([]));
    onBucketSelect(bucket);
  };

  // 显示右键菜单
  const showContextMenu = (e: React.MouseEvent, targetId: string | null, targetType: 'blank' | 'folder' | 'connection') => {
    e.preventDefault();
    e.stopPropagation();
    
    const rect = sidebarRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = Math.min(e.clientX - rect.left, rect.width - 150);
    const y = Math.min(e.clientY - rect.top, rect.height - 100);
    
    setContextMenu({
      visible: true,
      x,
      y,
      targetId,
      targetType
    });
  };

  // 隐藏右键菜单
  const hideContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  // 创建目录
  const handleCreateFolder = () => {
    const parentId = contextMenu.targetType === 'folder' ? contextMenu.targetId : null;
    const newFolderName = '新建目录';
    let finalName = newFolderName;
    let counter = 1;
    
    // 检查重名
    const siblings = items.filter(item => item.parentId === parentId);
    while (siblings.some(item => item.name === finalName)) {
      finalName = `${newFolderName} (${counter})`;
      counter++;
    }
    
    dispatch(addFolder({ name: finalName, parentId }));
    hideContextMenu();
    
    // 如果是创建在目录内，自动展开该目录
    if (parentId) {
      setExpandedFolders(prev => new Set(prev).add(parentId));
    }
  };

  // 创建连接
  const handleCreateConnection = () => {
    const parentId = contextMenu.targetType === 'folder' ? contextMenu.targetId : null;
    onAddConnection(parentId);
    hideContextMenu();
  };

  // 编辑连接
  const handleEdit = () => {
    if (contextMenu.targetId) {
      const item = items.find(i => i.id === contextMenu.targetId);
      if (item) {
        if (item.type === 'folder') {
          setRenaming({ id: item.id, name: item.name });
        } else {
          onEditConnection(item);
        }
      }
    }
    hideContextMenu();
  };

  // 删除
  const handleDelete = () => {
    if (contextMenu.targetId) {
      const item = items.find(i => i.id === contextMenu.targetId);
      if (item && confirm(`确定要删除"${item.name}"吗？${item.type === 'folder' ? '目录内的所有内容也将被删除。' : ''}`)) {
        dispatch(deleteItem(contextMenu.targetId));
      }
    }
    hideContextMenu();
  };

  // 保存重命名
  const handleRenameSave = () => {
    if (renaming && renaming.name.trim()) {
      dispatch(updateFolder({ id: renaming.id, name: renaming.name.trim() }));
    }
    setRenaming(null);
  };

  // 取消重命名
  const handleRenameCancel = () => {
    setRenaming(null);
  };

  // 拖拽开始
  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  // 拖拽结束
  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // 拖拽经过
  const handleDragOver = (e: React.DragEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedItem && draggedItem !== itemId) {
      const targetItem = items.find(i => i.id === itemId);
      if (targetItem?.type === 'folder') {
        setDragOverItem(itemId);
      }
    }
  };

  // 拖拽离开
  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  // 放置
  const handleDrop = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedItem && draggedItem !== targetId) {
      // 防止循环引用
      let parent = items.find(i => i.id === targetId);
      while (parent) {
        if (parent.id === draggedItem) {
          return;
        }
        parent = items.find(i => i.id === parent?.parentId);
      }
      
      dispatch(moveItem({ id: draggedItem, parentId: targetId }));
      
      // 如果放置到文件夹，自动展开
      if (targetId) {
        setExpandedFolders(prev => new Set(prev).add(targetId));
      }
    }
    
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // 渲染树项
  const renderTreeItem = (item: ConnectionItem, level: number = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isActive = currentConnectionId === item.id;
    const isDragOver = dragOverItem === item.id;
    const isDragging = draggedItem === item.id;
    const children = getChildren(item.id);
    const hasChildren = children.length > 0;

    if (item.type === 'folder') {
      return (
        <div key={item.id} className="tree-node">
          <div
            className={`tree-item folder-item ${isExpanded ? 'expanded' : ''} ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
            style={{ paddingLeft: `${12 + level * 16}px` }}
            onContextMenu={(e) => showContextMenu(e, item.id, 'folder')}
            draggable
            onDragStart={(e) => handleDragStart(e, item.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, item.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, item.id)}
          >
            <span 
              className={`tree-chevron ${isExpanded ? 'expanded' : ''} ${hasChildren ? 'has-children' : ''}`}
              onClick={(e) => hasChildren && toggleFolder(e, item.id)}
            >
              {hasChildren && <ChevronRight size={14} />}
            </span>
            <span className="tree-item-icon folder-icon">
              {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
            </span>
            {renaming?.id === item.id ? (
              <input
                ref={renameInputRef}
                className="tree-rename-input"
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onBlur={handleRenameSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSave();
                  if (e.key === 'Escape') handleRenameCancel();
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="tree-item-name">{item.name}</span>
            )}
            <GripVertical size={14} className="tree-drag-handle" />
          </div>
          {isExpanded && hasChildren && (
            <div className="tree-children">
              {children.map(child => renderTreeItem(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    // Connection item
    return (
      <div key={item.id} className="tree-node">
        <div
          className={`tree-item connection-item ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
          style={{ paddingLeft: `${12 + level * 16}px` }}
          onClick={() => handleSelectConnection(item)}
          onContextMenu={(e) => showContextMenu(e, item.id, 'connection')}
          draggable
          onDragStart={(e) => handleDragStart(e, item.id)}
          onDragEnd={handleDragEnd}
        >
          <span className="tree-chevron-placeholder" />
          <span className="tree-item-icon connection-icon">
            <Database size={14} />
          </span>
          <span className="tree-item-name">{item.name}</span>
          {isActive && isLoading && <span className="tree-loading">⏳</span>}
          <GripVertical size={14} className="tree-drag-handle" />
        </div>
      </div>
    );
  };

  return (
    <div 
      ref={sidebarRef}
      className="sidebar"
      onContextMenu={(e) => showContextMenu(e, null, 'blank')}
      onClick={hideContextMenu}
    >
      {/* 连接树形列表 - 最大高度50%，超过后滚动 */}
      <div className="sidebar-section connections-section">
        <div className="sidebar-section-header">
          <h3 className="sidebar-section-title">
            <Database size={14} />
            <span>我的连接</span>
            <span className="connection-count">
              ({items.filter(i => i.type === 'connection').length})
            </span>
          </h3>
          <button 
            className="sidebar-add-btn"
            onClick={() => onAddConnection(null)}
            title="添加连接"
          >
            <Plus size={16} />
          </button>
        </div>
        
        {items.length === 0 ? (
          <div 
            className="sidebar-empty-state"
            onContextMenu={(e) => showContextMenu(e, null, 'blank')}
          >
            <Folder size={32} className="empty-icon" />
            <p>右键点击空白处创建目录或连接</p>
          </div>
        ) : (
          <div 
            className="connection-tree"
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverItem(null);
            }}
            onDrop={(e) => handleDrop(e, null)}
          >
            {rootItems.map(item => renderTreeItem(item))}
          </div>
        )}
        
        {errorMessage && (
          <div className="sidebar-error">{errorMessage}</div>
        )}
      </div>

      {/* 存储桶列表 - 保持原位置，阻止右键菜单 */}
      {currentConnectionId && (
        <div
          className="sidebar-section buckets-section"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <h3 className="sidebar-section-title">
            <HardDrive size={14} />
            <span>存储桶</span>
            {isLoading && <span className="loading-spinner">⏳</span>}
          </h3>
          
          {buckets.length === 0 ? (
            <p className="sidebar-empty-text">
              {isLoading ? '加载中...' : '暂无存储桶'}
            </p>
          ) : (
            <ul className="sidebar-list buckets-list">
              {buckets.map((bucket) => (
                <li
                  key={bucket.id}
                  className={`sidebar-list-item ${currentBucket?.id === bucket.id ? 'active' : ''}`}
                  onClick={() => handleSelectBucket(bucket)}
                  title={bucket.region || '未知区域'}
                >
                  <HardDrive className="item-icon" size={14} />
                  <span className="item-name">{bucket.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu.visible && (
        <div 
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.targetType === 'blank' && (
            <>
              <div className="context-menu-item" onClick={handleCreateFolder}>
                <Folder size={14} />
                <span>新建目录</span>
              </div>
              <div className="context-menu-item" onClick={handleCreateConnection}>
                <Plus size={14} />
                <span>新建连接</span>
              </div>
            </>
          )}
          
          {contextMenu.targetType === 'folder' && (
            <>
              <div className="context-menu-item" onClick={handleCreateFolder}>
                <Folder size={14} />
                <span>新建子目录</span>
              </div>
              <div className="context-menu-item" onClick={handleCreateConnection}>
                <Plus size={14} />
                <span>新建连接</span>
              </div>
              <div className="context-menu-divider" />
              <div className="context-menu-item" onClick={handleEdit}>
                <Edit2 size={14} />
                <span>重命名</span>
              </div>
              <div className="context-menu-item danger" onClick={handleDelete}>
                <Trash2 size={14} />
                <span>删除</span>
              </div>
            </>
          )}
          
          {contextMenu.targetType === 'connection' && (
            <>
              <div className="context-menu-item" onClick={handleEdit}>
                <Edit2 size={14} />
                <span>编辑连接</span>
              </div>
              <div className="context-menu-item danger" onClick={handleDelete}>
                <Trash2 size={14} />
                <span>删除连接</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Sidebar;
