import type { ConnectionConfig } from '../../shared/types';
import type { ThemeMode } from '../store/slices/themeSlice';
import type { TransferTask } from '../store/slices/transfersSlice';

const STORAGE_KEY = 's3-client-connections';
const THEME_KEY = 's3-client-theme';
const TRANSFERS_KEY = 's3-client-transfers';

export class StorageService {
  static saveConnections(connections: ConnectionConfig[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
    } catch (error) {
      console.error('Failed to save connections:', error);
    }
  }

  static loadConnections(): ConnectionConfig[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];
      
      const connections = JSON.parse(data);
      // 转换日期字符串为 Date 对象，并处理属性名映射
      return connections.map((conn: any) => ({
        id: conn.id,
        name: conn.name,
        endpoint: conn.endpoint,
        region: conn.region || 'us-east-1',
        // 支持多种属性名格式
        accessKeyId: conn.accessKeyId || conn.access_key || '',
        secretAccessKey: conn.secretAccessKey || conn.secret_key || '',
        sessionToken: conn.sessionToken || conn.session_token,
        isDefault: conn.isDefault,
        createdAt: new Date(conn.createdAt || Date.now()),
        updatedAt: new Date(conn.updatedAt || Date.now()),
      }));
    } catch (error) {
      console.error('Failed to load connections:', error);
      return [];
    }
  }

  static clearConnections(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear connections:', error);
    }
  }

  // 主题相关方法
  static saveTheme(theme: ThemeMode): void {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  }

  static loadTheme(): ThemeMode {
    try {
      const theme = localStorage.getItem(THEME_KEY);
      return (theme as ThemeMode) || 'light';
    } catch (error) {
      console.error('Failed to load theme:', error);
      return 'light';
    }
  }

  // 传输任务持久化方法
  static saveTransfers(tasks: Record<string, TransferTask>): void {
    try {
      // 只保存可以恢复的任务（暂停或失败的）
      const resumableTasks: Record<string, TransferTask> = {};
      
      Object.values(tasks).forEach(task => {
        // 只保存支持断点续传且状态为暂停或失败的任务
        if (task.resumable && (task.status === 'paused' || task.status === 'failed')) {
          // 创建可序列化的任务副本
          resumableTasks[task.id] = {
            ...task,
            // 不保存 File 对象，因为它无法序列化
            file: undefined,
            createdAt: new Date(task.createdAt),
            updatedAt: new Date(task.updatedAt),
          };
        }
      });

      localStorage.setItem(TRANSFERS_KEY, JSON.stringify(resumableTasks));
    } catch (error) {
      console.error('Failed to save transfers:', error);
    }
  }

  static loadTransfers(): TransferTask[] {
    try {
      const data = localStorage.getItem(TRANSFERS_KEY);
      if (!data) return [];

      const tasks = JSON.parse(data);
      return Object.values(tasks).map((task: any) => ({
        ...task,
        createdAt: new Date(task.createdAt),
        updatedAt: new Date(task.updatedAt),
        // 恢复时状态设为暂停，等待用户手动恢复
        status: 'paused' as const,
      }));
    } catch (error) {
      console.error('Failed to load transfers:', error);
      return [];
    }
  }

  static clearTransfers(): void {
    try {
      localStorage.removeItem(TRANSFERS_KEY);
    } catch (error) {
      console.error('Failed to clear transfers:', error);
    }
  }

  // 保存单个传输任务
  static saveTransferTask(task: TransferTask): void {
    try {
      const existingData = localStorage.getItem(TRANSFERS_KEY);
      const tasks: Record<string, TransferTask> = existingData ? JSON.parse(existingData) : {};
      
      // 只保存支持断点续传的任务
      if (task.resumable) {
        tasks[task.id] = {
          ...task,
          file: undefined,
          createdAt: new Date(task.createdAt),
          updatedAt: new Date(task.updatedAt),
        };
        localStorage.setItem(TRANSFERS_KEY, JSON.stringify(tasks));
      }
    } catch (error) {
      console.error('Failed to save transfer task:', error);
    }
  }

  // 删除单个传输任务
  static removeTransferTask(taskId: string): void {
    try {
      const existingData = localStorage.getItem(TRANSFERS_KEY);
      if (!existingData) return;
      
      const tasks: Record<string, TransferTask> = JSON.parse(existingData);
      delete tasks[taskId];
      localStorage.setItem(TRANSFERS_KEY, JSON.stringify(tasks));
    } catch (error) {
      console.error('Failed to remove transfer task:', error);
    }
  }

}
