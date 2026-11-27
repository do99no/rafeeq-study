/**
 * المراجعة اليدوية لأسئلة اختبار تحديد المستوى، سؤالاً سؤالاً: كل سؤال قورن بمقطعه في الكتاب
 * (والمسائل أعيد حلها بصورة مستقلة). المعتمد وحده يدخل الاختبار؛ والمرفوض يُذكر سببه.
 * المعرّف من itemId(bookId, sectionId, نص السؤال)، فتعديل السؤال يلغي اعتماده تلقائياً.
 */
export interface SubjectReview {
  approved: string[]
  rejected: Record<string, string>
}
export const PLACEMENT_REVIEW: Record<string, SubjectReview> = {}
