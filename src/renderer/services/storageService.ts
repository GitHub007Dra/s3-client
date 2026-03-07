import type { ConnectionItem } from '../../shared/types';
import type { ThemeMode } from '../store/slices/themeSlice';
import type { TransferTask } from '../store/slices/transfersSlice';

const STORAGE_KEY = 's3-client-connections';
const THEME_KEY = 's3-client-theme';
const TRANSFERS_KEY = 's3-client-transfers';

// 安全配置：是否使用安全存储模式
// 启用后，凭证将使用 sessionStorage（关闭标签页后自动清除）
let useSecureStorage = false;

export class StorageService {
  /**
   * 启用安全存储模式
   * 启用后，凭证将存储在 sessionStorage 中，关闭标签页后自动清除
   * 注意：这会影响用户体验，用户每次打开应用都需要重新输入凭证
   */
  static setSecureStorage(enabled: boolean): void {
    useSecureStorage = enabled;
  }

  /**
   * 获取当前存储对象（localStorage 或 sessionStorage）
   */
  private static getStorage(): Storage {
    return useSecureStorage ? sessionStorage : localStorage;
  }

  /**
   * 清除所有敏感数据（凭证）
   * 建议在用户登出或应用关闭时调用
   */
  static clearSensitiveData(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear sensitive data:', error);
    }
  }

  static saveConnections(items: ConnectionItem[]): void {
    try {
      this.getStorage().setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error('Failed to save connections:', error);
    }
  }

  static loadConnections(): ConnectionItem[] {
    try {
      const data = this.getStorage().getItem(STORAGE_KEY);
      if (!data) return [];
      
      const parsed = JSON.parse(data);
      
      // 检查是否是新格式（包含 type 字段）
      if (Array.isArray(parsed) && parsed.length > 0 && 'type' in parsed[0]) {
        // 新格式：直接转换
        return parsed.map((item: any) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          parentId: item.parentId || null,
          createdAt: new Date(item.createdAt || Date.now()),
          updatedAt: new Date(item.updatedAt || Date.now()),
          connection: item.connection ? {
            id: item.connection.id,
            name: item.connection.name,
            endpoint: item.connection.endpoint,
            region: item.connection.region || 'us-east-1',
            accessKeyId: item.connection.accessKeyId || item.connection.access_key || '',
            secretAccessKey: item.connection.secretAccessKey || item.connection.secret_key || '',
            sessionToken: item.connection.sessionToken || item.connection.session_token,
            isDefault: item.connection.isDefault,
            createdAt: new Date(item.connection.createdAt || Date.now()),
            updatedAt: new Date(item.connection.updatedAt || Date.now()),
          } : undefined,
        }));
      }
      
      // 旧格式：ConnectionConfig[]，需要迁移
      console.log('Migrating old connections format to new format...');
      const migrated: ConnectionItem[] = parsed.map((conn: any) => ({
        id: conn.id,
        type: 'connection',
        name: conn.name,
        parentId: null,
        createdAt: new Date(conn.createdAt || Date.now()),
        updatedAt: new Date(conn.updatedAt || Date.now()),
        connection: {
          id: conn.id,
          name: conn.name,
          endpoint: conn.endpoint,
          region: conn.region || 'us-east-1',
          accessKeyId: conn.accessKeyId || conn.access_key || '',
          secretAccessKey: conn.secretAccessKey || conn.secret_key || '',
          sessionToken: conn.sessionToken || conn.session_token,
          isDefault: conn.isDefault,
          createdAt: new Date(conn.createdAt || Date.now()),
          updatedAt: new Date(conn.updatedAt || Date.now()),
        },
      }));
      
      // 保存迁移后的数据
      StorageService.saveConnections(migrated);
      return migrated;
    } catch (error) {
      console.error('Failed to load connections:', error);
      return [];
    }
  }

  static clearConnections(): void {
    try {
      this.getStorage().removeItem(STORAGE_KEY);
    } catch (error) {
      console.error('Failed to clear connections:', error);
    }
  }

  // 主题相关方法
  static saveTheme(theme: ThemeMode): void {
    try {
      // 主题设置使用 localStorage（不需要加密，用户体验优先）
      localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.error('Failed to save theme:', error);
    }
  }

  static loadTheme(): ThemeMode {
    try {
      // 主题设置使用 localStorage
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

      // 传输任务信息可以保存在 localStorage（不包含敏感凭证）
      localStorage.setItem(TRANSFERS_KEY, JSON.stringify(resumableTasks));
    } catch (error) {
      console.error('Failed to save transfers:', error);
    }
  }

  static loadTransfers(): TransferTask[] {
    try {
      // 传输任务信息从 localStorage 读取
      const data = localStorage.getItem(TRANSFERS_KEY);
      if (!data) return [];
      
      const tasks = JSON.parse(data);
      const result: TransferTask[] = [];
      
      Object.values(tasks).forEach((task: any) => {
        // 跳过无法恢复的上传任务（没有 localPath 且没有 file）
        if (task.type === 'upload' && !task.localPath && !task.file) {
          console.warn(`跳过无法恢复的上传任务: ${task.fileName}`);
          return;
        }
        
        result.push({
          ...task,
          createdAt: new Date(task.createdAt),
          updatedAt: new Date(task.updatedAt),
        });
      });
      
      return result;
    } catch (error) {
      console.error('Failed to load transfers:', error);
      return [];
    }
  }

  static clearTransfers(): void {
    try {
      // 传输任务信息从 localStorage 清除
      localStorage.removeItem(TRANSFERS_KEY);
    } catch (error) {
      console.error('Failed to clear transfers:', error);
    }
  }

  // 保存单个传输任务
  static saveTransferTask(task: TransferTask): void {
    try {
      // 传输任务信息从 localStorage 读取
      const existingData = localStorage.getItem(TRANSFERS_KEY);
      const tasks: Record<string, TransferTask> = existingData ? JSON.parse(existingData) : {};
      
      // 只有可恢复的任务才保存
      if (task.resumable && (task.status === 'paused' || task.status === 'failed')) {
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
      // 传输任务信息从 localStorage 读取
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
