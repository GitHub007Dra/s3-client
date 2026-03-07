import type { ConnectionConfig, PresignedUrl } from '../../../shared/types';
import type { AppDispatch } from '../../store';
import { setItems, setCurrentConnection, setLoading, setError } from '../../store/slices/connectionsSlice';
import { BucketsService } from './buckets';

/**
 * 连接管理模块
 */
export class ConnectionsService {
  private bucketsService: BucketsService;
  private dispatch: AppDispatch;

  constructor(bucketsService: BucketsService, dispatch: AppDispatch) {
    this.bucketsService = bucketsService;
    this.dispatch = dispatch;
  }

  /**
   * 管理连接（测试并保存）
   */
  async manageConnections(configs: ConnectionConfig[]): Promise<void> {
    try {
      this.dispatch(setLoading(true));
      
      // Test all connections
      const validConnections = await Promise.all(
        configs.map(async (config) => {
          const isValid = await this.bucketsService.testConnection(config);
          return isValid ? config : null;
        })
      );

      const connections = validConnections.filter(Boolean) as ConnectionConfig[];
      
      // Convert to ConnectionItem format and dispatch
      const items = connections.map(conn => ({
        id: conn.id,
        type: 'connection' as const,
        name: conn.name,
        parentId: null,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
        connection: conn,
      }));
      
      this.dispatch(setItems(items));
      
      // Set first connection as default if none is set
      if (connections.length > 0 && !connections.find(c => c.isDefault)) {
        connections[0].isDefault = true;
        this.dispatch(setCurrentConnection(connections[0].id));
      }

      this.dispatch(setLoading(false));
    } catch (error) {
      this.dispatch(setError('Failed to manage connections'));
      this.dispatch(setLoading(false));
      throw error;
    }
  }
}