import type { ConnectionConfig } from '../../shared/types';
import type { ThemeMode } from '../store/slices/themeSlice';

const STORAGE_KEY = 's3-client-connections';
const THEME_KEY = 's3-client-theme';

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

}
