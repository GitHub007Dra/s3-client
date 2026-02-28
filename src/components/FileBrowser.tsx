import React, { useEffect, useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { FileItem, Bucket } from '../shared/types';
import { setFiles, setCurrentPath, setBreadcrumb, setLoading, setError } from '../renderer/store/slices/filesSlice';
import { S3Service } from '../renderer/services/s3Service';
import { Folder, FileText, Download, Share2, Trash2 } from 'lucide-react';

interface FileBrowserProps {
  bucket: Bucket | null;
  connectionId: string | null;
}

const FileBrowser: React.FC<FileBrowserProps> = ({ bucket, connectionId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const items = useSelector((state: RootState) => state.files.items);
  const currentPath = useSelector((state: RootState) => state.files.currentPath);
  const breadcrumb = useSelector((state: RootState) => state.files.breadcrumb);
  const loading = useSelector((state: RootState) => state.files.loading);
  const error = useSelector((state: RootState) => state.files.error);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 加载文件列表
  useEffect(() => {
    if (bucket && connectionId) {
      loadFiles(connectionId, bucket.name, currentPath);
    }
  }, [bucket, connectionId, currentPath]);

  const loadFiles = async (connId: string, bucketName: string, prefix: string) => {
    dispatch(setLoading(true));
    dispatch(setError(null));
    try {
      const s3Service = new S3Service(dispatch);
      const s3Objects = await s3Service.listObjects(connId, bucketName, prefix);
      
      // 构建面包屑
      const parts = prefix.split('/').filter(Boolean);
      dispatch(setBreadcrumb(parts));
      
      // 只显示当前路径的直接子项
      const prefixLen = prefix.length;
      const seenPaths = new Set<string>();
      const directItems: FileItem[] = [];
      
      s3Objects.forEach(obj => {
        const key = obj.key;
        
        // 跳过当前路径本身
        if (key === prefix || key === prefix.slice(0, -1)) return;
        
        if (prefixLen > 0) {
          // 非根目录
          if (!key.startsWith(prefix)) return;
          
          const relativePath = key.slice(prefixLen);
          const parts = relativePath.split('/').filter(Boolean);
          
          // 只处理直接子项（路径中只有一个部分）
          if (parts.length === 1) {
            // 直接文件或空文件夹标记
            if (!seenPaths.has(key)) {
              seenPaths.add(key);
              directItems.push({
                name: parts[0],
                path: key,
                isFolder: key.endsWith('/'),
                size: obj.size,
                lastModified: obj.lastModified,
              });
            }
          } else if (parts.length > 1) {
            // 子文件夹（路径中有多个部分）
            const folderName = parts[0];
            const folderPath = prefix + folderName + '/';
            if (!seenPaths.has(folderPath)) {
              seenPaths.add(folderPath);
              directItems.push({
                name: folderName,
                path: folderPath,
                isFolder: true,
                size: 0,
                lastModified: obj.lastModified,
              });
            }
          }
        } else {
          // 根目录
          const parts = key.split('/').filter(Boolean);
          
          if (parts.length === 1) {
            // 根目录下的直接文件或空文件夹标记
            if (!seenPaths.has(key)) {
              seenPaths.add(key);
              directItems.push({
                name: parts[0],
                path: key,
                isFolder: key.endsWith('/'),
                size: obj.size,
                lastModified: obj.lastModified,
              });
            }
          } else if (parts.length > 1) {
            // 根目录下的子文件夹
            const folderName = parts[0];
            const folderPath = folderName + '/';
            if (!seenPaths.has(folderPath)) {
              seenPaths.add(folderPath);
              directItems.push({
                name: folderName,
                path: folderPath,
                isFolder: true,
                size: 0,
                lastModified: obj.lastModified,
              });
            }
          }
        }
      });
      
      // 按文件夹在前、文件在后排序
      directItems.sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        return a.name.localeCompare(b.name);
      });
      
      dispatch(setFiles(directItems));
    } catch (err) {
      dispatch(setError(err instanceof Error ? err.message : '加载文件失败'));
    } finally {
      dispatch(setLoading(false));
    }
  };

  // 处理面包屑导航点击
  const handleBreadcrumbClick = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    const newPath = parts.slice(0, index + 1).join('/') + '/';
    dispatch(setCurrentPath(newPath));
  };

  // 处理返回上级
  const handleNavigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    // 确保路径以 / 结尾，如果是空路径则返回根目录
    const newPath = parts.length > 0 ? parts.join('/') + '/' : '';
    dispatch(setCurrentPath(newPath));
  };

  // 处理文件/文件夹点击
  const handleItemClick = (item: FileItem) => {
    if (item.isFolder) {
      dispatch(setCurrentPath(item.path));
    } else {
      const newSelected = new Set(selectedItems);
      if (newSelected.has(item.path)) {
        newSelected.delete(item.path);
      } else {
        newSelected.add(item.path);
      }
      setSelectedItems(newSelected);
    }
  };

  // 处理文件/文件夹双击
  const handleItemDoubleClick = (item: FileItem) => {
    if (item.isFolder) {
      dispatch(setCurrentPath(item.path));
    } else {
      console.log('Double click on file:', item.name);
    }
  };

  // 刷新文件列表
  const handleRefresh = () => {
    if (bucket && connectionId) {
      loadFiles(connectionId, bucket.name, currentPath);
    }
  };

  // 处理文件上传
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 处理文件夹上传
  const handleUploadFolderClick = () => {
    folderInputRef.current?.click();
  };

  // 处理拖拽进入
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  // 处理拖拽离开
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // 处理拖拽悬停
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // 处理文件放置
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0 || !bucket || !connectionId) return;

    const s3Service = new S3Service(dispatch);
    
    for (const file of Array.from(files)) {
      const key = currentPath + file.name;
      try {
        await s3Service.uploadFile(file, connectionId, bucket.name, key);
      } catch (err) {
        console.error('Upload failed:', err);
        alert(`上传文件 ${file.name} 失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    }

    // 刷新文件列表
    loadFiles(connectionId, bucket.name, currentPath);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !bucket || !connectionId) return;

    const s3Service = new S3Service(dispatch);
    
    for (const file of Array.from(files)) {
      const key = currentPath + file.name;
      try {
        await s3Service.uploadFile(file, connectionId, bucket.name, key);
      } catch (err) {
        console.error('Upload failed:', err);
        alert(`上传文件 ${file.name} 失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    }
    
    // 刷新文件列表
    handleRefresh();
    
    // 清空 input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 处理文件夹上传
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !bucket || !connectionId) return;

    const s3Service = new S3Service(dispatch);
    let uploadedCount = 0;
    let failedCount = 0;
    
    for (const file of Array.from(files)) {
      // 获取文件的相对路径
      const relativePath = file.webkitRelativePath || file.name;
      const key = currentPath + relativePath;
      
      try {
        await s3Service.uploadFile(file, connectionId, bucket.name, key);
        uploadedCount++;
      } catch (err) {
        console.error('Upload failed:', err);
        failedCount++;
      }
    }
    
    // 刷新文件列表
    handleRefresh();
    
    // 显示结果
    if (failedCount > 0) {
      alert(`上传完成：成功 ${uploadedCount} 个，失败 ${failedCount} 个`);
    } else {
      alert(`上传完成：成功上传 ${uploadedCount} 个文件`);
    }
    
    // 清空 input
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  // 新建文件夹
  const handleNewFolderClick = () => {
    setNewFolderName('');
    setShowNewFolderModal(true);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !bucket || !connectionId) return;

    const s3Service = new S3Service(dispatch);
    const folderKey = currentPath + newFolderName.trim() + '/';
    
    try {
      await s3Service.createFolder(connectionId, bucket.name, folderKey);
      setShowNewFolderModal(false);
      setNewFolderName('');
      handleRefresh();
    } catch (err) {
      console.error('Create folder failed:', err);
      alert(`创建文件夹失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  // 下载文件
  const handleDownload = async (item: FileItem) => {
    if (!bucket || !connectionId || item.isFolder) return;

    const s3Service = new S3Service(dispatch);
    
    try {
      // 使用带传输任务的方式下载，会在 TransferProgress 面板显示
      await s3Service.downloadFile(connectionId, bucket.name, item.path, item.name);
    } catch (err) {
      console.error('Download failed:', err);
      // 用户取消不提示错误
      if (err instanceof Error && err.name !== 'AbortError') {
        alert(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`);
      }
    }
  };

  // 分享文件
  const handleShare = async (item: FileItem) => {
    if (!bucket || !connectionId || item.isFolder) return;

    const s3Service = new S3Service(dispatch);
    
    try {
      const presignedUrl = await s3Service.getPresignedUrl(connectionId, bucket.name, item.path, 86400); // 24小时
      setShareUrl(presignedUrl.url);
      setShowShareModal(true);
    } catch (err) {
      console.error('Share failed:', err);
      alert(`生成分享链接失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const copyShareUrl = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      alert('分享链接已复制到剪贴板');
    }
  };

  // 删除文件/文件夹
  const handleDelete = async (item: FileItem) => {
    if (!bucket || !connectionId) return;

    const confirmMessage = item.isFolder 
      ? `确定要删除文件夹 "${item.name}" 及其所有内容吗？` 
      : `确定要删除文件 "${item.name}" 吗？`;
    
    if (!window.confirm(confirmMessage)) return;

    const s3Service = new S3Service(dispatch);
    
    try {
      if (item.isFolder) {
        await s3Service.deleteFolder(connectionId, bucket.name, item.path);
      } else {
        await s3Service.deleteObject(connectionId, bucket.name, item.path);
      }
      handleRefresh();
    } catch (err) {
      console.error('Delete failed:', err);
      alert(`删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleString('zh-CN');
  };

  if (!bucket) {
    return (
      <div className="file-browser-empty">
        <div className="empty-icon">📂</div>
        <p className="text-gray-500">请选择一个存储桶</p>
      </div>
    );
  }

  return (
    <div
      className="file-browser"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={isDragging ? {
        border: '2px dashed #10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)'
      } : undefined}
    >
      {/* 工具栏 */}
      <div className="file-toolbar">
        <div className="toolbar-left">
          <button
            className="toolbar-btn"
            onClick={handleNavigateUp}
            disabled={!currentPath}
            title="返回上级"
          >
            返回上级
          </button>
          <button className="toolbar-btn" onClick={handleRefresh} title="刷新">
            刷新
          </button>
          <button className="toolbar-btn" onClick={handleNewFolderClick} title="新建文件夹">
            新建文件夹
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            multiple
          />
          <button className="toolbar-btn primary" onClick={handleUploadClick} title="上传文件">
            上传文件
          </button>
          <input
            type="file"
            ref={folderInputRef}
            onChange={handleFolderChange}
            style={{ display: 'none' }}
            // @ts-ignore - webkitdirectory 是非标准属性
            webkitdirectory=""
            multiple
          />
          <button className="toolbar-btn primary" onClick={handleUploadFolderClick} title="上传文件夹">
            上传文件夹
          </button>
        </div>
        <div className="toolbar-right">
        </div>
      </div>

      {/* 面包屑导航 */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        width: '100%',
        padding: '8px 16px',
        borderBottom: '1px solid #e0e0e0',
        backgroundColor: '#fff',
        fontSize: '13px',
        boxSizing: 'border-box',
        overflowX: 'auto',
        overflowY: 'hidden',
        margin: 0
      }}>
        <span
          onClick={() => dispatch(setCurrentPath(''))}
          style={{ color: '#10b981', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {bucket.name}
        </span>
        {breadcrumb.map((part, index) => (
          <React.Fragment key={index}>
            <span style={{ margin: '0 4px', color: '#ccc' }}>›</span>
            <span
              onClick={() => handleBreadcrumbClick(index)}
              style={{
                color: index === breadcrumb.length - 1 ? '#333' : '#666',
                cursor: 'pointer',
                fontWeight: index === breadcrumb.length - 1 ? 500 : 400,
                whiteSpace: 'nowrap'
              }}
            >
              {part}
            </span>
          </React.Fragment>
        ))}
      </div>

      {/* 文件列表 */}
      <div className="file-list-container">
        {loading ? (
          <div className="file-loading">
            <div className="loading-spinner"></div>
            <p>加载中...</p>
          </div>
        ) : error ? (
          <div className="file-error">
            <p className="text-red-500">❌ {error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="file-empty">
            <div className="empty-icon">📭</div>
            <p className="text-gray-500">此文件夹为空</p>
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th className="col-name">名称</th>
                <th className="col-size">大小</th>
                <th className="col-date">修改日期</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.path}
                  className={`file-row ${selectedItems.has(item.path) ? 'selected' : ''}`}
                  onClick={() => handleItemClick(item)}
                  onDoubleClick={() => handleItemDoubleClick(item)}
                >
                  <td className="col-name">
                    <div className="file-item-wrapper">
                      {item.isFolder ? (
                        <Folder className="file-icon folder-icon" size={14} />
                      ) : (
                        <FileText className="file-icon file-type-icon" size={14} />
                      )}
                      <span className="file-name">{item.name || '(未命名)'}</span>
                    </div>
                  </td>
                  <td className="col-size">{formatSize(item.size || 0)}</td>
                  <td className="col-date">{formatDate(item.lastModified || new Date())}</td>
                  <td className="col-actions">
                    {!item.isFolder && (
                      <button
                        className="action-btn icon-only"
                        title="下载"
                        style={{ padding: '4px 6px', borderRadius: '4px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(item);
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.setProperty('background-color', '#dcfce7', 'important');
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '';
                        }}
                      >
                        <Download size={14} />
                      </button>
                    )}
                    {!item.isFolder && (
                      <button
                        className="action-btn icon-only"
                        title="分享"
                        style={{ padding: '4px 6px', borderRadius: '4px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShare(item);
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.setProperty('background-color', '#dcfce7', 'important');
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '';
                        }}
                      >
                        <Share2 size={14} />
                      </button>
                    )}
                    <button
                      className="action-btn delete icon-only"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 状态栏 */}
      <div className="file-statusbar">
        <span>共 {items.length} 个项目</span>
      </div>

      {/* 新建文件夹弹窗 */}
      {showNewFolderModal && (
        <div className="modal-overlay" onClick={() => setShowNewFolderModal(false)}>
          <div className="modal-content new-folder-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">新建文件夹</h3>
              <button className="modal-close-btn" onClick={() => setShowNewFolderModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="folder-icon-large">📁</div>
              <p className="modal-description">在当前位置创建一个新文件夹</p>
              <div className="form-group">
                <label className="form-label">文件夹名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="请输入文件夹名称"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder();
                    if (e.key === 'Escape') setShowNewFolderModal(false);
                  }}
                />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 分享链接弹窗 */}
      {showShareModal && shareUrl && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal-content share-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🔗 分享链接</h3>
              <button className="modal-close-btn" onClick={() => setShowShareModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="share-icon-large">🔗</div>
              <p className="share-description">
                链接已生成，有效期 <strong>24小时</strong>
              </p>
              <div className="share-url-wrapper">
                <label className="share-label">分享链接</label>
                <div className="share-url-container">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="share-url-input"
                  />
                  <button onClick={copyShareUrl} className="copy-btn">
                    📋 复制
                  </button>
                </div>
              </div>
              <p className="share-hint">
                💡 提示：复制链接后发送给他人，对方可在24小时内访问该文件
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowShareModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileBrowser;
