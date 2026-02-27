import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../renderer/store';
import type { Bucket } from '../shared/types';
import { setCurrentBucket, setFiles, setCurrentPath } from '../renderer/store/slices/filesSlice';

interface BucketListProps {
  onBucketSelect: (bucket: Bucket) => void;
}

const BucketList: React.FC<BucketListProps> = ({ onBucketSelect }) => {
  const dispatch = useDispatch<AppDispatch>();
  const buckets = useSelector((state: RootState) => state.files.buckets);
  const currentBucket = useSelector((state: RootState) => state.files.currentBucket);
  const loading = useSelector((state: RootState) => state.files.loading);

  const handleSelectBucket = async (bucket: Bucket) => {
    dispatch(setCurrentBucket(bucket));
    dispatch(setCurrentPath(''));
    dispatch(setFiles([]));
    onBucketSelect(bucket);
  };

  if (loading) {
    return (
      <div className="bucket-list-empty">
        <p className="text-gray-500 text-sm">正在加载存储桶...</p>
      </div>
    );
  }

  if (buckets.length === 0) {
    return (
      <div className="bucket-list-empty">
        <p className="text-gray-500 text-sm">暂无存储桶</p>
        <p className="text-gray-400 text-xs mt-1">点击连接后将在此显示存储桶列表</p>
      </div>
    );
  }

  return (
    <div className="bucket-list">
      <h3 className="bucket-list-title">存储桶列表</h3>
      <ul className="bucket-list-items">
        {buckets.map((bucket) => (
          <li
            key={bucket.id}
            className={`bucket-list-item ${currentBucket?.id === bucket.id ? 'active' : ''}`}
            onClick={() => handleSelectBucket(bucket)}
          >
            <span className="bucket-icon">🪣</span>
            <span className="bucket-name">{bucket.name}</span>
            <span className="bucket-region">{bucket.region}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default BucketList;