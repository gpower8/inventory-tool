// Simple error utilities for the cafe ordering system
export function logError(message: string, error?: any): void {
  console.error(`Error: ${message}`);
  if (error) {
    console.error('Details:', error);
  }
}

export function getSimpleErrorMessage(error: any): string {
  if (error?.message?.includes('insufficient') || error?.message?.includes('stock')) {
    return 'Insufficient ingredients for this item.';
  }
  
  if (error?.message?.includes('not found')) {
    return 'Item not found.';
  }
  
  if (error?.message?.includes('database') || error?.code === 'SQLITE_BUSY') {
    return 'A database error occurred. Please try again.';
  }
  
  return 'An unexpected error occurred. Please try again.';
} 