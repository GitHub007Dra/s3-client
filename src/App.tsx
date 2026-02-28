import { useState, useEffect } from 'react';
import { Provider, useDispatch } from 'react-redux';
import { store } from './renderer/store';
import type { AppDispatch } from './renderer/store';
import { addTransferTask } from './renderer/store/slices/transfersSlice';
import { StorageService } from './renderer/services/storageService';
import Sidebar from './components/Sidebar';
import FileBrowser from './components/FileBrowser';
import ConnectionModal from './components/ConnectionModal';
import TransferProgress from './components/TransferProgress';
import type { Bucket } from './shared/types';
import './App.css';

// 内部组件
function AppContent() {
  const dispatch = useDispatch<AppDispatch>();
  const [currentBucket, setCurrentBucket] = useState<Bucket | null>(null);
  const [currentConnectionId, setCurrentConnectionId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 应用启动时恢复未完成的传输任务
  useEffect(() => {
    const loadUnfinishedTransfers = () => {
      const savedTasks = StorageService.loadTransfers();
      if (savedTasks.length > 0) {
        savedTasks.forEach(task => {
          dispatch(addTransferTask(task));
        });
        console.log(`Restored ${savedTasks.length} unfinished transfer tasks`);
      }
    };

    loadUnfinishedTransfers();
  }, [dispatch]);

  const handleConnectionSelect = (connectionId: string) => {
    setCurrentConnectionId(connectionId);
    setCurrentBucket(null);
  };

  const handleBucketSelect = (bucket: Bucket) => {
    setCurrentBucket(bucket);
  };

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">S3 客户端</h1>
      </header>
      
      <main className="app-main">
        <aside className="app-sidebar">
          <Sidebar 
            onManageConnections={handleOpenModal}
            onConnectionSelect={handleConnectionSelect}
            onBucketSelect={handleBucketSelect}
          />
        </aside>
        
        <div className="app-workspace">
          {currentConnectionId ? (
            currentConnectionId && currentBucket ? (
              <FileBrowser
                bucket={currentBucket}
                connectionId={currentConnectionId}
              />
            ) : (
              <div className="bucket-view">
                <h2 className="view-title">存储桶列表</h2>
                <div className="bucket-placeholder">
                  <p>请从左侧选择一个存储桶来浏览文件</p>
                </div>
              </div>
            )
          ) : (
            <div className="workspace-empty">
              <div className="empty-icon">📁</div>
              <h2 className="empty-title">欢迎使用 S3 客户端</h2>
              <p className="empty-description">
                这是一个跨平台的 S3 客户端工具，支持 AWS S3、MinIO、Cloudflare R2、阿里云 OSS、腾讯云 COS 等多种 S3 兼容存储服务。
              </p>
              <div className="empty-steps">
                <h3>开始使用：</h3>
                <ol>
                  <li>点击左侧"管理连接"按钮</li>
                  <li>添加新的 S3 连接配置</li>
                  <li>填写 Endpoint、Region、Access Key 和 Secret Key</li>
                  <li>点击"测试连接"验证配置</li>
                  <li>点击"添加"保存连接</li>
                  <li>选择已保存的连接查看存储桶</li>
                  <li>选择存储桶浏览文件</li>
                </ol>
              </div>
              <div className="empty-features">
                <h3>功能特性：</h3>
                <ul>
                  <li>✓ 多连接管理</li>
                  <li>✓ 文件/文件夹上传下载</li>
                  <li>✓ 分片上传大文件</li>
                  <li>✓ 预签名链接生成</li>
                  <li>✓ 拖拽支持</li>
                  <li>✓ 右键菜单操作</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 连接管理弹窗 */}
      <ConnectionModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onConnectionSelect={handleConnectionSelect}
      />

      {/* 底部传输进度栏 */}
      <TransferProgress />
    </div>
  );
}

// 主组件，提供 Redux Provider
function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
}

export default App;
