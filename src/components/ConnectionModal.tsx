import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../renderer/store';
import type { ConnectionConfig, ConnectionItem } from '../shared/types';
import { S3Service } from '../renderer/services/modules';
import { addConnection, updateConnection, setCurrentConnection } from '../renderer/store/slices/connectionsSlice';
import { setBuckets, setCurrentBucket, setFiles, setCurrentPath } from '../renderer/store/slices/filesSlice';
import { ChevronDown, Database, X } from 'lucide-react';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingItem: ConnectionItem | null;
  parentId: string | null;
  onConnectionSelect: (connectionId: string) => void;
}

// 表单默认值
const DEFAULT_VALUES = {
  region: 'us-east-1',
};

const ConnectionModal: React.FC<ConnectionModalProps> = ({ 
  isOpen, 
  onClose, 
  editingItem,
  parentId,
  onConnectionSelect 
}) => {
  const [connectionName, setConnectionName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const dispatch = useDispatch<AppDispatch>();
  const existingItems = useSelector((state: RootState) => state.connections.items);

  const isEditing = editingItem?.type === 'connection';

  // 重置表单当弹窗打开时
  useEffect(() => {
    if (isOpen) {
      if (isEditing && editingItem?.connection) {
        // 编辑模式：加载现有连接数据
        const conn = editingItem.connection;
        setConnectionName(conn.name);
        setEndpoint(conn.endpoint);
        setRegion(conn.region || '');
        setAccessKey(conn.accessKeyId);
        setSecretKey(conn.secretAccessKey);
        setSessionToken(conn.sessionToken || '');
        setShowAdvanced(Boolean(conn.region || conn.sessionToken));
      } else {
        // 新建模式：清空表单，使用默认值
        setConnectionName('');
        setEndpoint('');
        setRegion('');
        setAccessKey('');
        setSecretKey('');
        setSessionToken('');
        setShowAdvanced(false);
      }
      setTestResult(null);
    }
  }, [isOpen, editingItem, isEditing]);

  const getRegionValue = (): string => {
    // 如果用户填写了，使用用户填写的
    if (region.trim()) return region.trim();
    // 否则使用默认值
    return DEFAULT_VALUES.region;
  };

  const handleTestConnection = async () => {
    if (!connectionName || !endpoint || !accessKey || !secretKey) {
      setTestResult('✗ 请填写所有必填字段');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    const config: ConnectionConfig = {
      id: isEditing ? editingItem!.id : Date.now().toString(),
      name: connectionName,
      endpoint,
      region: getRegionValue(),
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      sessionToken,
      createdAt: isEditing ? editingItem!.connection!.createdAt : new Date(),
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

  const handleSave = async () => {
    if (!connectionName || !endpoint || !accessKey || !secretKey) {
      setTestResult('✗ 请填写所有必填字段');
      return;
    }

    // 检查是否已存在同名连接（编辑模式下排除自己）
    const isDuplicateName = existingItems.some(
      item =>
        item.type === 'connection' &&
        item.connection?.name === connectionName.trim() &&
        item.id !== (isEditing ? editingItem?.id : undefined)
    );
    
    if (isDuplicateName) {
      setTestResult('✗ 已存在同名连接，请使用其他名称');
      return;
    }

    setIsSaving(true);

    const config: ConnectionConfig = {
      id: isEditing ? editingItem!.id : Date.now().toString(),
      name: connectionName,
      endpoint,
      region: getRegionValue(),
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      sessionToken,
      createdAt: isEditing ? editingItem!.connection!.createdAt : new Date(),
      updatedAt: new Date(),
    };

    try {
      const s3Service = new S3Service(dispatch);
      
      // 先测试连接是否有效
      await s3Service.connect(config);
      const s3Buckets = await s3Service.listBuckets(config.id);
      
      // 连接测试通过后才添加到列表
      if (isEditing) {
        dispatch(updateConnection(config));
      } else {
        dispatch(addConnection({ config, parentId }));
        dispatch(setCurrentConnection(config.id));
        onConnectionSelect(config.id);
      }

      // 加载存储桶列表
      if (!s3Buckets || s3Buckets.length === 0) {
        dispatch(setBuckets([]));
      } else {
        const buckets: import('../shared/types').Bucket[] = s3Buckets.map((b, index) => ({
          id: `${config.id}-${b.name}-${index}`,
          name: b.name,
          region: b.region,
          creationDate: b.creationDate,
        }));
        dispatch(setBuckets(buckets));
      }
      
      dispatch(setCurrentBucket(null));
      dispatch(setFiles([]));
      dispatch(setCurrentPath(''));
      
      onClose();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setTestResult('✗ 保存失败: ' + errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content connection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrapper">
            <Database size={20} className="modal-icon" />
            <h2 className="modal-title">
              {isEditing ? '编辑连接' : '添加连接'}
            </h2>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="connection-form">
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
                <label className="form-label">Access Key ID *</label>
                <input
                  type="text"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                  className="form-input"
                  placeholder="Enter your Access Key ID"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Secret Access Key *</label>
                <input
                  type="password"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  className="form-input"
                  placeholder="Enter your Secret Access Key"
                />
              </div>
            </div>

            <div className="form-advanced">
              <button
                type="button"
                className={`advanced-toggle ${showAdvanced ? 'expanded' : ''}`}
                onClick={() => setShowAdvanced((value) => !value)}
              >
                <ChevronDown size={14} />
                <span>高级选项</span>
              </button>

              {showAdvanced && (
                <div className="advanced-grid">
                  <div className="form-group">
                    <label className="form-label">
                      Region 区域
                      <span className="form-hint">（可选）</span>
                    </label>
                    <input
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      className="form-input"
                      placeholder="例如 us-east-1"
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">
                      Session Token
                      <span className="form-hint">（可选）</span>
                    </label>
                    <input
                      type="text"
                      value={sessionToken}
                      onChange={(e) => setSessionToken(e.target.value)}
                      className="form-input"
                      placeholder="临时凭证的会话令牌"
                    />
                  </div>
                </div>
              )}
            </div>

            {testResult && (
              <div className={`test-result ${testResult.startsWith('✓') ? 'success' : 'error'}`}>
                {testResult}
              </div>
            )}

            <div className="form-actions">
              <button 
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={isTesting || isSaving}
              >
                {isTesting ? '测试中...' : '测试连接'}
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : (isEditing ? '保存修改' : '添加连接')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectionModal;
