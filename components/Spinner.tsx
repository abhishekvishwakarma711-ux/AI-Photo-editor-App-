
import React from 'react';

interface SpinnerProps {
    large?: boolean;
}

const Spinner: React.FC<SpinnerProps> = ({ large = false }) => {
  const sizeClasses = large ? 'w-12 h-12' : 'w-5 h-5';
  const borderClasses = large ? 'border-4' : 'border-2';

  return (
    <div 
        className={`${sizeClasses} ${borderClasses} border-t-transparent border-white rounded-full animate-spin`}
        role="status"
        aria-label="loading"
    ></div>
  );
};

export default Spinner;
