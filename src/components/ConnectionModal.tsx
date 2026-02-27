import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { ConnectionConfig } from '../shared/types';
import { S3Service } from '../renderer/services/s3Service';
import { addConnection, updateConnection, deleteConnection, setCurrentConnection } from '../renderer/store/slices/connectionsSlice';
import { setBuckets, setCurrentBucket, setFiles, setCurrentPath } from '../renderer/store/slices/filesSlice';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSelect: (connectionId: string) => void;
}

const ConnectionModal: React.FC<ConnectionModalProps> = ({ isOpen, onClose, onConnectionSelect }) => {
  const [connectionName, setConnectionName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const connections = useSelector((state: RootState) => state.connections.connections);
  const currentConnectionId = useSelector((state: RootState) => state.connections.currentConnectionId);
  const dispatch = useDispatch<AppDispatch>();

  // 重置表单当弹窗打开时
  useEffect(() => {
    if (isOpen) {
      clearForm();
    }
  }, [isOpen]);

  const loadConnectionToForm = (conn: ConnectionConfig) => {
    setEditingId(conn.id);
    setConnectionName(conn.name);
    setEndpoint(conn.endpoint);
    setRegion(conn.region || '');
    setAccessKey(conn.accessKeyId);
    setSecretKey(conn.secretAccessKey);
    setSessionToken(conn.sessionToken || '');
    setTestResult(null);
  };

  const clearForm = () => {
    setEditingId(null);
    setConnectionName('');
    setEndpoint('');
    setRegion('');
    setAccessKey('');
    setSecretKey('');
    setSessionToken('');
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!connectionName || !endpoint || !accessKey || !secretKey) {
      setTestResult('✗ 请填写所有必填字段');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const config: ConnectionConfig = {
      id: editingId || Date.now().toString(),
      name: connectionName,
      endpoint,
      region,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      sessionToken,
      createdAt: editingId ? connections.find(c => c.id === editingId)?.createdAt || new Date() : new Date(),
      updatedAt: new Date(),
    };

    try {
      const s3Service = new S3Service(dispatch);
      const isValid = await s3Service.testConnection(config);
      setTestResult(isValid ? '✓ 连接成功!' : '✗ 连接失败，请检查配置');
    } catch (error) {
      setTestResult('✗ 连接失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleAddOrUpdateConnection = async () => {
    if (!connectionName || !endpoint || !accessKey || !secretKey) {
      setTestResult('✗ 请填写所有必填字段');
      return;
    }

    const config: ConnectionConfig = {
      id: editingId || Date.now().toString(),
      name: connectionName,
      endpoint,
      region,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      sessionToken,
      createdAt: editingId ? connections.find(c => c.id === editingId)?.createdAt || new Date() : new Date(),
      updatedAt: new Date(),
    };

    if (editingId) {
      dispatch(updateConnection(config));
      setTestResult('✓ 连接已更新!');
    } else {
      dispatch(addConnection(config));
      dispatch(setCurrentConnection(config.id));
      onConnectionSelect(config.id);
      setTestResult('✓ 连接已保存!');
    }

    clearForm();
  };

  const handleDeleteConnection = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个连接吗？')) {
      dispatch(deleteConnection(id));
      if (currentConnectionId === id) {
        dispatch(setCurrentConnection(null));
        dispatch(setBuckets([]));
        dispatch(setFiles([]));
        dispatch(setCurrentBucket(null));
        dispatch(setCurrentPath(''));
      }
    }
  };

  const handleSelectConnection = async (conn: ConnectionConfig) => {
    dispatch(setCurrentConnection(conn.id));
    onConnectionSelect(conn.id);
    onClose();

    // 加载存储桶列表
    try {
      const s3Service = new S3Service(dispatch);
      await s3Service.connect(conn);
      const s3Buckets = await s3Service.listBuckets(conn.id);

      if (!s3Buckets || s3Buckets.length === 0) {
        dispatch(setBuckets([]));
      } else {
        const buckets: import('../shared/types').Bucket[] = s3Buckets.map((b, index) => ({
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
      setTestResult('连接失败: ' + errorMsg);
      dispatch(setBuckets([]));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">管理连接</h2>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* 表单区域 */}
          <div className="connection-form">
            <h3 className="form-section-title">{editingId ? '编辑连接' : '添加新连接'}</h3>
            
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">连接名称 *</label>
                <input
                  type="text"
                  value={connectionName}
                  onChange={(e) => setConnectionName(e.target.value)}
                  className="form-input"
                  placeholder="我的S3连接"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Endpoint 地址 *</label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="form-input"
                  placeholder="https://s3.amazonaws.com"
                />
              </div>

              <div className="form-group">
                <label className="form-label">区域 Region</label>
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="form-input"
                  placeholder="us-east-1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Access Key *</label>
                <input
                  type="text"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="form-input"
                  placeholder="AKIA..."
                />
              </div>

              <div className="form-group">
                <label className="form-label">Secret Key *</label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="form-input"
                  placeholder="••••••••"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Session Token (可选)</label>
                <input
                  type="text"
                  value={sessionToken}
                  onChange={(e) => setSessionToken(e.target.value)}
                  className="form-input"
                  placeholder="可选的会话令牌"
                />
              </div>
            </div>

            <div className="form-actions">
              <button
                onClick={handleTestConnection}
                disabled={isTesting}
                className="btn btn-secondary"
              >
                {isTesting ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={handleAddOrUpdateConnection}
                className="btn btn-primary"
              >
                {editingId ? '更新' : '添加'}
              </button>
              {editingId && (
                <button
                  onClick={clearForm}
                  className="btn btn-ghost"
                >
                  取消编辑
                </button>
              )}
            </div>

            {testResult && (
              <div className={`test-result ${testResult.includes('成功') || testResult.includes('更新') ? 'success' : 'error'}`}>
                {testResult}
              </div>
            )}
          </div>

          {/* 已保存的连接列表 */}
          <div className="saved-connections">
            <h3 className="form-section-title">已保存的连接</h3>
            <div className="connections-list">
              {connections.length === 0 ? (
                <p className="empty-text">暂无保存的连接</p>
              ) : (
                connections.map((conn: ConnectionConfig) => (
                  <div
                    key={conn.id}
                    className={`connection-item ${currentConnectionId === conn.id ? 'active' : ''}`}
                    onClick={() => handleSelectConnection(conn)}
                  >
                    <div className="connection-info">
                      <div className="connection-name">{conn.name}</div>
                      <div className="connection-endpoint">{conn.endpoint}</div>
                    </div>
                    <div className="connection-actions">
                      <button
                        onClick={(e) => { e.stopPropagation(); loadConnectionToForm(conn); }}
                        className="action-btn edit"
                        title="编辑"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={(e) => handleDeleteConnection(conn.id, e)}
                        className="action-btn delete"
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionModal;
