/**
 * Error categorization for Dokan — produces Arabic user-facing messages.
 * Extracted and enhanced from the original ErrorBoundary pattern.
 */

export type ErrorCategory =
  | 'DATABASE_PROJECTS'
  | 'DATABASE_GENERAL'
  | 'NETWORK'
  | 'AUTH_PERMISSION'
  | 'UI_RENDER';

export interface ErrorDetails {
  category: ErrorCategory;
  title: string;
  userMessage: string;
  badgeText: string;
  recommendation: string;
  icon: 'database' | 'network' | 'auth' | 'alert';
}

export function categorizeError(error: Error | null): ErrorDetails {
  const msg = (error?.message || '').toLowerCase();
  const stack = (error?.stack || '').toLowerCase();

  if (
    msg.includes('projects') ||
    msg.includes('project') ||
    msg.includes('table_id') ||
    msg.includes('tables') ||
    msg.includes('relation') ||
    msg.includes('pgrst') ||
    msg.includes('column') ||
    msg.includes('does not exist')
  ) {
    return {
      category: 'DATABASE_PROJECTS',
      title: 'تعذّر تحميل بيانات المتجر والجداول',
      userMessage: 'فشل النظام في استرجاع بيانات المتاجر والجداول من قاعدة البيانات.',
      badgeText: 'خطأ تحميل الجداول',
      recommendation: 'تأكد من استقرار الاتصال، ثم انقر على "إعادة التحميل". إذا استمرت المشكلة، تواصل مع الدعم.',
      icon: 'database',
    };
  }

  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('abort')
  ) {
    return {
      category: 'NETWORK',
      title: 'فشل الاتصال بالشبكة',
      userMessage: 'يبدو أن هناك ضعفاً أو انقطاعاً في الاتصال بالإنترنت.',
      badgeText: 'انقطاع الشبكة',
      recommendation: 'يرجى التحقق من اتصال الإنترنت، ثم أعد محاولة التحديث.',
      icon: 'network',
    };
  }

  if (
    msg.includes('unauthorized') ||
    msg.includes('jwt') ||
    msg.includes('permission denied') ||
    msg.includes('row-level security') ||
    msg.includes('rls') ||
    msg.includes('not authenticated') ||
    msg.includes('session')
  ) {
    return {
      category: 'AUTH_PERMISSION',
      title: 'انتهت صلاحية الجلسة أو تعذر التحقق',
      userMessage: 'لم نتمكن من إكمال الطلب بسبب قيود الصلاحيات أو انتهاء رمز الدخول.',
      badgeText: 'خطأ صلاحيات',
      recommendation: 'يرجى إعادة تسجيل الدخول للتحقق من صلاحيات حسابك.',
      icon: 'auth',
    };
  }

  if (
    msg.includes('postgres') ||
    msg.includes('supabase') ||
    msg.includes('database') ||
    msg.includes('db') ||
    msg.includes('query') ||
    msg.includes('insert') ||
    msg.includes('update') ||
    msg.includes('delete')
  ) {
    return {
      category: 'DATABASE_GENERAL',
      title: 'خلل مؤقت في استعلام البيانات',
      userMessage: 'تعذّرت معالجة بيانات الطلب بشكل صحيح من القاعدة.',
      badgeText: 'خطأ قاعدة البيانات',
      recommendation: 'يرجى إعادة تحميل التطبيق لمزامنة بياناتك.',
      icon: 'database',
    };
  }

  return {
    category: 'UI_RENDER',
    title: 'توقف مؤقت في عرض الواجهة',
    userMessage: 'حدث تعثر في عرض أحد مكونات الشاشة بشكل غير متوقع.',
    badgeText: 'خطأ في الواجهة',
    recommendation: 'إعادة تحميل الصفحة ستستعيد بناء عناصر الشاشة وتتيح لك مواصلة العمل.',
    icon: 'alert',
  };
}

/** Persist error to sessionStorage for diagnostics */
export function persistErrorLog(error: Error, details: ErrorDetails): void {
  try {
    const entry = {
      id: `err_${Date.now()}`,
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      category: details.category,
    };
    const existing = JSON.parse(sessionStorage.getItem('dokan_error_logs') || '[]');
    const updated = [entry, ...existing].slice(0, 15);
    sessionStorage.setItem('dokan_error_logs', JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
}
