import React, { useState, useMemo, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import { S3Service } from '../renderer/services/s3Service';
import {
  removeTransferTask,
  clearCompletedTransfers,
  type TransferTask,
  type TransferType,
} from '../renderer/store/slices/transfersSlice';
import {
  Upload,
  Download,
  Pause,
  Play,
  X,
  Trash2,
  ChevronDown,
  FileText,
  CheckCircle2,
  AlertCircle,
  Clock,
  Zap,
  MoreHorizontal,
} from 'lucide-react';
import './TransferProgress.css';

// 格式化文件大小
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
};

// 格式化速度
const formatSpeed = (bytesPerSecond: number): string => {
  if (bytesPerSecond === 0) return '-';
  return formatFileSize(bytesPerSecond) + '/s';
};

// 格式化剩余时间
const formatTimeRemaining = (seconds: number): string => {
  if (!isFinite(seconds) || seconds <= 0) return '-';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  if (seconds < 3600) return Math.ceil(seconds / 60) + 'm';
  return Math.ceil(seconds / 3600) + 'h';
};

// 获取文件图标
const getFileIcon = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (!ext) return <FileText size={18} />;
  
  // 可以根据扩展名返回不同图标
  return <FileText size={18} />;
};

// 单个任务项组件
interface TransferItemProps {
  task: TransferTask;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

const TransferItem: React.FC<TransferItemProps> = ({
  task,
  onPause,
  onResume,
  onCancel,
  onRemove,
}) => {
  const isUpload = task.type === 'upload';
  const isActive = task.status === 'uploading' || task.status === 'downloading';
  const isPaused = task.status === 'paused';
  const isCompleted = task.status === 'completed';
  const isFailed = task.status === 'failed';
  const isCancelled = task.status === 'cancelled';

  // 计算剩余时间
  const timeRemaining = useMemo(() => {
    if (!isActive || task.speed === 0) return null;
    const remaining = (task.total - task.transferred) / task.speed;
    return formatTimeRemaining(remaining);
  }, [isActive, task.speed, task.total, task.transferred]);

  // 计算进度百分比
  const progressPercent = Math.min(100, Math.max(0, task.progress));

  // 获取状态颜色和图标
  const getStatusConfig = () => {
    if (isFailed) return { color: 'error', icon: <AlertCircle size={14} /> };
    if (isCompleted) return { color: 'success', icon: <CheckCircle2 size={14} /> };
    if (isPaused) return { color: 'warning', icon: <Pause size={14} /> };
    if (isCancelled) return { color: 'muted', icon: <X size={14} /> };
    return { color: 'active', icon: isUpload ? <Upload size={14} /> : <Download size={14} /> };
  };

  const statusConfig = getStatusConfig();

  return (
    <div className={`transfer-item ${task.status}`}>
      <div className="transfer-item-main">
        {/* 文件图标和名称 */}
        <div className="transfer-item-file">
          <div className={`transfer-item-icon ${statusConfig.color}`}>
            {getFileIcon(task.fileName)}
          </div>
          <div className="transfer-item-info">
            <span className="transfer-item-filename" title={task.fileName}>
              {task.fileName}
            </span>
            <div className="transfer-item-meta">
              <span className="meta-size">
                {formatFileSize(task.transferred)} / {formatFileSize(task.total)}
              </span>
              {isActive && task.speed > 0 && (
                <>
                  <span className="meta-separator">•</span>
                  <span className="meta-speed">
                    <Zap size={10} />
                    {formatSpeed(task.speed)}
                  </span>
                </>
              )}
              {isActive && timeRemaining && (
                <>
                  <span className="meta-separator">•</span>
                  <span className="meta-time">
                    <Clock size={10} />
                    {timeRemaining}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 进度和操作 */}
        <div className="transfer-item-right">
          {/* 进度条和百分比 */}
          <div className="transfer-item-progress">
            <div className="progress-bar-container">
              <div
                className={`progress-bar ${isFailed ? 'error' : ''} ${isCompleted ? 'success' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className={`progress-percent ${statusConfig.color}`}>
              {isCompleted ? 'Done' : `${Math.round(progressPercent)}%`}
            </span>
          </div>

          {/* 操作按钮 */}
          <div className="transfer-item-actions">
            {isActive && (
              <button
                className="action-btn pause"
                onClick={() => onPause(task.id)}
                title="暂停"
              >
                <Pause size={14} />
              </button>
            )}
            {isPaused && (
              <button
                className="action-btn resume"
                onClick={() => onResume(task.id)}
                title="继续"
              >
                <Play size={14} />
              </button>
            )}
            {(isActive || isPaused) && (
              <button
                className="action-btn cancel"
                onClick={() => onCancel(task.id)}
                title="取消"
              >
                <X size={14} />
              </button>
            )}
            {(isCompleted || isFailed || isCancelled) && (
              <button
                className="action-btn remove"
                onClick={() => onRemove(task.id)}
                title="移除"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 错误信息 */}
      {task.error && (
        <div className="transfer-item-error">
          <AlertCircle size={12} />
          {task.error}
        </div>
      )}
    </div>
  );
};

// 主组件
const TransferProgress: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TransferType | 'all'>('all');

  const { tasks, activeTasks, completedTasks, failedTasks } = useSelector(
    (state: RootState) => state.transfers
  );

  const taskCount = Object.keys(tasks).length;

  // 过滤任务
  const filteredTasks = useMemo(() => {
    let taskList = Object.values(tasks);
    if (activeTab !== 'all') {
      taskList = taskList.filter((task) => task.type === activeTab);
    }
    // 按创建时间倒序排列
    return taskList.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [tasks, activeTab]);

  // 统计
  const stats = useMemo(() => {
    const uploading = activeTasks.filter(
      (id) => tasks[id]?.type === 'upload'
    ).length;
    const downloading = activeTasks.filter(
      (id) => tasks[id]?.type === 'download'
    ).length;
    return { uploading, downloading, completed: completedTasks.length, failed: failedTasks.length };
  }, [activeTasks, completedTasks, failedTasks, tasks]);

  // 是否有活动任务
  const hasActiveTasks = activeTasks.length > 0;

  // 处理操作
  const handlePause = useCallback((id: string) => {
    const s3Service = new S3Service(dispatch);
    s3Service.pauseTransfer(id);
  }, [dispatch]);
  
  const handleResume = useCallback(async (id: string) => {
    const task = tasks[id];
    if (!task) return;
    
    // 如果是上传任务，需要用户选择文件
    if (task.type === 'upload' && !task.file) {
      // 创建一个隐藏的文件输入，让用户选择文件
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const s3Service = new S3Service(dispatch);
          await s3Service.resumeTransfer(task, file);
        }
      };
      input.click();
    } else {
      // 下载任务或已有文件的上传任务
      const s3Service = new S3Service(dispatch);
      await s3Service.resumeTransfer(task);
    }
  }, [dispatch, tasks]);
  
  const handleCancel = useCallback((id: string) => {
    const s3Service = new S3Service(dispatch);
    s3Service.cancelTransfer(id);
  }, [dispatch]);
  
  const handleRemove = useCallback((id: string) => dispatch(removeTransferTask(id)), [dispatch]);
  const handleClearCompleted = useCallback(() => dispatch(clearCompletedTransfers()), [dispatch]);

  // 关闭面板
  const handleClose = useCallback(() => {
    setIsExpanded(false);
  }, []);

  // 如果没有任务，不显示组件
  if (taskCount === 0) {
    return null;
  }

  return (
    <>
      {/* 浮动指示器（折叠时显示） */}
      {!isExpanded && (
        <div 
          className="transfer-floating-indicator"
          onClick={() => setIsExpanded(true)}
        >
          <div className="indicator-content">
            {hasActiveTasks ? (
              <>
                <span className="indicator-count">{activeTasks.length}</span>
                <span className="indicator-text">传输中</span>
              </>
            ) : (
              <>
                <span className="indicator-count">{completedTasks.length}</span>
                <span className="indicator-text">已完成</span>
              </>
            )}
          </div>
          {hasActiveTasks && (
            <div className="indicator-progress">
              <div 
                className="indicator-progress-bar" 
                style={{ 
                  width: `${
                    Object.values(tasks).reduce((acc, t) => acc + t.progress, 0) / taskCount
                  }%` 
                }} 
              />
            </div>
          )}
        </div>
      )}

      {/* 展开的面板 */}
      {isExpanded && (
        <div className="transfer-panel-overlay" onClick={handleClose}>
          <div className="transfer-panel" onClick={(e) => e.stopPropagation()}>
            {/* 面板头部 */}
            <div className="transfer-panel-header">
              <div className="panel-title">
                <div className="panel-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v8"/>
                    <path d="m5 7 7-5 7 5"/>
                    <path d="M4 10h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10Z"/>
                    <path d="M12 14v4"/>
                  </svg>
                </div>
                <span>传输中心</span>
                <span className="panel-count">{taskCount}</span>
              </div>
              <div className="panel-actions">
                {completedTasks.length > 0 && (
                  <button
                    className="panel-action-btn clear"
                    onClick={handleClearCompleted}
                    title="清除已完成"
                  >
                    <Trash2 size={14} />
                    清除已完成
                  </button>
                )}
                <button
                  className="panel-action-btn close"
                  onClick={handleClose}
                  title="关闭"
                >
                  <ChevronDown size={18} />
                </button>
              </div>
            </div>

            {/* 标签页 */}
            <div className="transfer-tabs">
              <button
                className={`transfer-tab ${activeTab === 'all' ? 'active' : ''}`}
                onClick={() => setActiveTab('all')}
              >
                全部
                <span className="tab-count">{Object.keys(tasks).length}</span>
              </button>
              <button
                className={`transfer-tab ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('upload')}
              >
                <Upload size={12} />
                上传
                {stats.uploading > 0 && <span className="tab-badge">{stats.uploading}</span>}
              </button>
              <button
                className={`transfer-tab ${activeTab === 'download' ? 'active' : ''}`}
                onClick={() => setActiveTab('download')}
              >
                <Download size={12} />
                下载
                {stats.downloading > 0 && <span className="tab-badge">{stats.downloading}</span>}
              </button>
            </div>

            {/* 任务列表 */}
            <div className="transfer-list">
              {filteredTasks.length === 0 ? (
                <div className="transfer-empty">
                  <div className="empty-icon">
                    <MoreHorizontal size={32} />
                  </div>
                  <p>该分类下暂无任务</p>
                </div>
              ) : (
                filteredTasks.map((task) => (
                  <TransferItem
                    key={task.id}
                    task={task}
                    onPause={handlePause}
                    onResume={handleResume}
                    onCancel={handleCancel}
                    onRemove={handleRemove}
                  />
                ))
              )}
            </div>

            {/* 底部统计 */}
            <div className="transfer-panel-footer">
              <div className="footer-stats">
                {stats.uploading > 0 && (
                  <span className="stat-item uploading">
                    <Upload size={12} />
                    {stats.uploading} 上传中
                  </span>
                )}
                {stats.downloading > 0 && (
                  <span className="stat-item downloading">
                    <Download size={12} />
                    {stats.downloading} 下载中
                  </span>
                )}
                {stats.failed > 0 && (
                  <span className="stat-item failed">
                    <AlertCircle size={12} />
                    {stats.failed} 失败
                  </span>
                )}
                {stats.completed > 0 && !hasActiveTasks && (
                  <span className="stat-item completed">
                    <CheckCircle2 size={12} />
                    {stats.completed} 已完成
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default TransferProgress;
