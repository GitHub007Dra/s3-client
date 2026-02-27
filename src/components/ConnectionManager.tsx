import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { ConnectionConfig } from '../shared/types';
import { S3Service } from '../renderer/services/s3Service';
import { addConnection, setCurrentConnection, deleteConnection, updateConnection } from '../renderer/store/slices/connectionsSlice';
import { setBuckets, setCurrentBucket, setFiles, setCurrentPath } from '../renderer/store/slices/filesSlice';

interface ConnectionManagerProps {
  onConnectionSelect: (connectionId: string) => void;
}

const ConnectionManager: React.FC<ConnectionManagerProps> = ({ onConnectionSelect }) => {
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

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const handleSelectConnection = async (conn: ConnectionConfig) => {
    console.log('========== [DEBUG] handleSelectConnection START ==========');
    console.log('[DEBUG] Connection ID:', conn.id);
    console.log('[DEBUG] Connection Name:', conn.name);
    console.log('[DEBUG] Endpoint:', conn.endpoint);
    console.log('[DEBUG] Region:', conn.region);
    console.log('[DEBUG] accessKeyId:', conn.accessKeyId ? '***' : 'EMPTY');
    console.log('[DEBUG] secretAccessKey:', conn.secretAccessKey ? '***' : 'EMPTY');
    
    setIsLoading(true);
    setErrorMessage(null);
    
    dispatch(setCurrentConnection(conn.id));
    onConnectionSelect(conn.id);
    
    // 加载存储桶列表
    try {
      console.log('[DEBUG] Step 1: Creating S3Service...');
      const s3Service = new S3Service(dispatch);
      
      console.log('[DEBUG] Step 2: Connecting to S3...');
      await s3Service.connect(conn);
      console.log('[DEBUG] Step 2: S3 connected successfully');
      
      console.log('[DEBUG] Step 3: Listing buckets...');
      const s3Buckets = await s3Service.listBuckets(conn.id);
      console.log('[DEBUG] Step 3: Buckets received:', s3Buckets);
      console.log('[DEBUG] Step 3: Bucket count:', s3Buckets?.length || 0);
      
      if (!s3Buckets || s3Buckets.length === 0) {
        console.log('[DEBUG] Step 4: No buckets found, dispatching empty array');
        dispatch(setBuckets([]));
      } else {
        const buckets: import('../shared/types').Bucket[] = s3Buckets.map((b, index) => ({
          id: `${conn.id}-${b.name}-${index}`,
          name: b.name,
          region: b.region,
          creationDate: b.creationDate,
        }));
        console.log('[DEBUG] Step 4: Dispatching buckets:', buckets);
        dispatch(setBuckets(buckets));
      }
      
      dispatch(setCurrentBucket(null));
      dispatch(setFiles([]));
      dispatch(setCurrentPath(''));
      console.log('[DEBUG] Step 5: All state dispatched');
      console.log('========== [DEBUG] handleSelectConnection END ==========');
    } catch (error) {
      console.error('[DEBUG] ERROR:', error);
      console.error('[DEBUG] Error name:', error instanceof Error ? error.name : 'Unknown');
      console.error('[DEBUG] Error stack:', error instanceof Error ? error.stack : 'No stack');
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage('连接失败: ' + errorMsg);
      dispatch(setBuckets([]));
      console.log('========== [DEBUG] handleSelectConnection ERROR END ==========');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 bg-gray-50 h-full">
      <h2 className="text-lg font-bold mb-4 text-gray-800">连接管理</h2>
      
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">连接名称 *</label>
          <input
            type="text"
            value={connectionName}
            onChange={(e) => setConnectionName(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="我的S3连接"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint 地址 *</label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="https://s3.amazonaws.com"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">区域 Region</label>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="us-east-1"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Access Key *</label>
          <input
            type="text"
            value={accessKey}
            onChange={(e) => setAccessKey(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="AKIA..."
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Secret Key *</label>
          <input
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Session Token (可选)</label>
          <input
            type="text"
            value={sessionToken}
            onChange={(e) => setSessionToken(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-900 placeholder-gray-400"
            placeholder="可选的会话令牌"
          />
        </div>

        <div className="flex space-x-2 pt-2">
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="flex-1 px-3 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {isTesting ? '测试中...' : '测试'}
          </button>
          <button
            onClick={handleAddOrUpdateConnection}
            className="flex-1 px-3 py-2 text-sm bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors"
          >
            {editingId ? '更新' : '添加'}
          </button>
          {editingId && (
            <button
              onClick={clearForm}
              className="px-3 py-2 text-sm bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
            >
              取消
            </button>
          )}
        </div>

        {testResult && (
          <div className={`p-2 text-sm rounded-md ${testResult.includes('成功') || testResult.includes('更新') ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
            {testResult}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold mb-2 text-gray-700">已保存的连接</h3>
        <div className="space-y-2">
          {connections.length === 0 ? (
            <p className="text-sm text-gray-400 italic">暂无保存的连接</p>
          ) : (
            connections.map((conn: ConnectionConfig) => (
              <div
                key={conn.id}
                className={`p-3 border rounded-md transition-colors cursor-pointer ${
                  currentConnectionId === conn.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
                onClick={() => handleSelectConnection(conn)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-800">{conn.name}</div>
                    <div className="text-xs text-gray-500 truncate">{conn.endpoint}</div>
                  </div>
                  <div className="flex space-x-1 ml-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); loadConnectionToForm(conn); }}
                      className="p-1 text-xs text-blue-500 hover:text-blue-700"
                      title="编辑"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => handleDeleteConnection(conn.id, e)}
                      className="p-1 text-xs text-red-500 hover:text-red-700"
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {/* 加载状态 */}
        {isLoading && (
          <div className="mt-3 p-2 text-sm text-blue-600 bg-blue-50 rounded-md flex items-center">
            <span className="animate-spin mr-2">⏳</span>
            正在加载存储桶列表...
          </div>
        )}
        
        {/* 错误消息 */}
        {errorMessage && (
          <div className="mt-3 p-2 text-sm text-red-600 bg-red-50 rounded-md">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionManager;