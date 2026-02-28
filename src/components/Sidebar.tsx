import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { ConnectionConfig, Bucket } from '../shared/types';
import { setCurrentConnection } from '../renderer/store/slices/connectionsSlice';
import { setCurrentBucket, setFiles, setCurrentPath, setBuckets } from '../renderer/store/slices/filesSlice';
import { S3Service } from '../renderer/services/s3Service';
import { HardDrive } from 'lucide-react';

interface SidebarProps {
  onManageConnections: () => void;
  onConnectionSelect: (connectionId: string) => void;
  onBucketSelect: (bucket: Bucket) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  onManageConnections, 
  onConnectionSelect,
  onBucketSelect 
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const connections = useSelector((state: RootState) => state.connections.connections);
  const currentConnectionId = useSelector((state: RootState) => state.connections.currentConnectionId);
  const buckets = useSelector((state: RootState) => state.files.buckets);
  const currentBucket = useSelector((state: RootState) => state.files.currentBucket);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSelectConnection = async (conn: ConnectionConfig) => {
    if (currentConnectionId === conn.id) return;
    
    setIsLoading(true);
    setErrorMessage(null);
    
    dispatch(setCurrentConnection(conn.id));
    onConnectionSelect(conn.id);
    
    try {
      const s3Service = new S3Service(dispatch);
      await s3Service.connect(conn);
      const s3Buckets = await s3Service.listBuckets(conn.id);
      
      if (!s3Buckets || s3Buckets.length === 0) {
        dispatch(setBuckets([]));
      } else {
        const buckets: Bucket[] = s3Buckets.map((b, index) => ({
          id: `${conn.id}-${b.name}-${index}`,
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

  const handleSelectBucket = (bucket: Bucket) => {
    dispatch(setCurrentBucket(bucket));
    dispatch(setCurrentPath(''));
    dispatch(setFiles([]));
    onBucketSelect(bucket);
  };

  const currentConnection = connections.find(c => c.id === currentConnectionId);

  return (
    <div className="sidebar">
      {/* 连接管理按钮 */}
      <div className="sidebar-section">
        <button 
          className="manage-connections-btn"
          onClick={onManageConnections}
        >
          <span className="btn-icon">⚙️</span>
          <span>管理连接</span>
        </button>
      </div>

      {/* 已保存的连接列表 */}
      <div className="sidebar-section">
        <h3 className="sidebar-section-title">连接</h3>
        {connections.length === 0 ? (
          <p className="sidebar-empty-text">暂无连接</p>
        ) : (
          <ul className="sidebar-list">
            {connections.map((conn) => (
              <li
                key={conn.id}
                className={`sidebar-list-item ${currentConnectionId === conn.id ? 'active' : ''}`}
                onClick={() => handleSelectConnection(conn)}
                title={conn.endpoint}
              >
                <span className="item-icon">🔗</span>
                <span className="item-name">{conn.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 当前连接的存储桶列表 */}
      {currentConnection && (
        <div className="sidebar-section">
          <h3 className="sidebar-section-title">
            <span>存储桶</span>
            {isLoading && <span className="loading-spinner">⏳</span>}
          </h3>
          
          {errorMessage && (
            <div className="sidebar-error">{errorMessage}</div>
          )}
          
          {buckets.length === 0 ? (
            <p className="sidebar-empty-text">
              {isLoading ? '加载中...' : '暂无存储桶'}
            </p>
          ) : (
            <ul className="sidebar-list">
              {buckets.map((bucket) => (
                <li
                  key={bucket.id}
                  className={`sidebar-list-item ${currentBucket?.id === bucket.id ? 'active' : ''}`}
                  onClick={() => handleSelectBucket(bucket)}
                  title={bucket.region || '未知区域'}
                >
                  <HardDrive className="item-icon" size={16} />
                  <span className="item-name">{bucket.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default Sidebar;
