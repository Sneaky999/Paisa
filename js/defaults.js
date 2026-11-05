// Default categories, accounts and picker options.

export const DEFAULT_CATEGORIES = [
  { id: 'cat-exp-food', name: 'Food', type: 'expense', icon: '🍜', color: '#c2410c' },
  { id: 'cat-exp-transport', name: 'Transportation', type: 'expense', icon: '🚌', color: '#2563eb' },
  { id: 'cat-exp-housing', name: 'Housing', type: 'expense', icon: '🏠', color: '#7c3aed' },
  { id: 'cat-exp-shopping', name: 'Shopping', type: 'expense', icon: '🛍️', color: '#be185d' },
  { id: 'cat-exp-health', name: 'Healthcare', type: 'expense', icon: '💊', color: '#0891b2' },
  { id: 'cat-exp-education', name: 'Education', type: 'expense', icon: '🎓', color: '#4d7c0f' },
  { id: 'cat-exp-fun', name: 'Entertainment', type: 'expense', icon: '🎬', color: '#ca8a04' },
  { id: 'cat-exp-bills', name: 'Bills', type: 'expense', icon: '🧾', color: '#475569' },
  { id: 'cat-exp-other', name: 'Others', type: 'expense', icon: '📦', color: '#64748b', fallback: true },
  { id: 'cat-inc-salary', name: 'Salary', type: 'income', icon: '💼', color: '#0f766e' },
  { id: 'cat-inc-freelance', name: 'Freelance', type: 'income', icon: '💻', color: '#2563eb' },
  { id: 'cat-inc-business', name: 'Business', type: 'income', icon: '🏪', color: '#7c3aed' },
  { id: 'cat-inc-invest', name: 'Investment', type: 'income', icon: '📈', color: '#15803d' },
  { id: 'cat-inc-gifts', name: 'Gifts', type: 'income', icon: '🎁', color: '#be185d' },
  { id: 'cat-inc-other', name: 'Others', type: 'income', icon: '💰', color: '#64748b', fallback: true },
];

export const DEFAULT_ACCOUNT = { id: 'acc-cash', name: 'Cash', type: 'cash', opening: 0, isDefault: true };

export const ACCOUNT_TYPES = {
  cash: { label: 'Cash', icon: '💵' },
  bank: { label: 'Bank account', icon: '🏦' },
  wallet: { label: 'Digital wallet', icon: '📱' },
  other: { label: 'Other', icon: '👛' },
};

export const ICON_CHOICES = ['🍜', '🚌', '🏠', '🛍️', '💊', '🎓', '🎬', '🧾', '📦', '💼', '💻', '🏪', '📈', '🎁', '💰', '☕', '🛒', '⛽', '✈️', '🐶', '👶', '🏋️', '📱', '🎮', '🎵', '🔧', '💡', '🙏'];

export const COLOR_CHOICES = ['#0f766e', '#2563eb', '#c2410c', '#7c3aed', '#be185d', '#ca8a04', '#0891b2', '#4d7c0f', '#9f1239', '#475569', '#b45309', '#64748b'];

export const FALLBACK_COLOR = '#94a3b8';
