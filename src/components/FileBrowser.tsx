import React, { useEffect, useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { FileItem, Bucket } from '../shared/types';
import { setFiles, setCurrentPath, setBreadcrumb, setLoading, setError } from '../renderer/store/slices/filesSlice';
import { S3Service } from '../renderer/services/s3Service';

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        
        if (prefixLen > 0) {
          // 非根目录
          if (!key.startsWith(prefix)) return;
          
          const relativePath = key.slice(prefixLen);
          const parts = relativePath.split('/');
          
          // 只处理直接子项（路径中只有一个 /）
          if (parts.length === 1) {
            // 直接文件
            if (!seenPaths.has(key) && parts[0]) {
              seenPaths.add(key);
              directItems.push({
                name: parts[0],
                path: key,
                isFolder: key.endsWith('/'),
                size: obj.size,
                lastModified: obj.lastModified,
              });
            }
          } else if (parts.length === 2 && parts[1] === '' && parts[0]) {
            // 直接子文件夹（过滤掉空名称的）
            const folderPath = prefix + parts[0] + '/';
            if (!seenPaths.has(folderPath)) {
              seenPaths.add(folderPath);
              directItems.push({
                name: parts[0],
                path: folderPath,
                isFolder: true,
                size: 0,
                lastModified: obj.lastModified,
              });
            }
          }
        } else {
          // 根目录
          const parts = key.split('/');
          if (parts.length === 1) {
            // 根目录下的直接文件
            if (!seenPaths.has(key) && parts[0]) {
              seenPaths.add(key);
              directItems.push({
                name: parts[0],
                path: key,
                isFolder: key.endsWith('/'),
                size: obj.size,
                lastModified: obj.lastModified,
              });
            }
          } else if (parts.length === 2 && parts[1] === '' && parts[0]) {
            // 根目录下的直接子文件夹（过滤掉空名称的）
            const folderPath = parts[0] + '/';
            if (!seenPaths.has(folderPath)) {
              seenPaths.add(folderPath);
              directItems.push({
                name: parts[0],
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
      const presignedUrl = await s3Service.getPresignedUrl(connectionId, bucket.name, item.path, 3600);
      
      // 创建临时链接下载
      const link = document.createElement('a');
      link.href = presignedUrl.url;
      link.download = item.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download failed:', err);
      alert(`下载失败: ${err instanceof Error ? err.message : '未知错误'}`);
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
    <div className="file-browser">
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
        </div>
        <div className="toolbar-right">
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
        </div>
      </div>

      {/* 面包屑导航 */}
      <div className="file-breadcrumb">
        <span className="breadcrumb-item bucket-name" onClick={() => dispatch(setCurrentPath(''))}>
          {bucket.name}
        </span>
        {breadcrumb.map((part, index) => (
          <React.Fragment key={index}>
            <span className="breadcrumb-separator">/</span>
            <span
              className={`breadcrumb-item ${index === breadcrumb.length - 1 ? 'active' : ''}`}
              onClick={() => handleBreadcrumbClick(index)}
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
                    <span className="file-icon">{item.isFolder ? '📁' : '📄'}</span>
                    <span className="file-name">{item.name || '(未命名)'}</span>
                  </td>
                  <td className="col-size">{formatSize(item.size || 0)}</td>
                  <td className="col-date">{formatDate(item.lastModified || new Date())}</td>
                  <td className="col-actions">
                    {!item.isFolder && (
                      <button 
                        className="action-btn" 
                        title="下载"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(item);
                        }}
                      >
                        下载
                      </button>
                    )}
                    {!item.isFolder && (
                      <button 
                        className="action-btn" 
                        title="分享"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShare(item);
                        }}
                      >
                        分享
                      </button>
                    )}
                    <button 
                      className="action-btn delete" 
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item);
                      }}
                    >
                      删除
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
        <span>已选择 {selectedItems.size} 个</span>
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
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>分享链接</h3>
            <p className="share-info">链接有效期：24小时</p>
            <div className="share-url-container">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="share-url-input"
              />
              <button onClick={copyShareUrl} className="copy-btn">
                复制
              </button>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShowShareModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileBrowser;
