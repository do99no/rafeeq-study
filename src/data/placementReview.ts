/**
 * المراجعة اليدوية لأسئلة اختبار تحديد المستوى، سؤالاً سؤالاً: كل سؤال قورن بمقطعه في الكتاب
 * (والمسائل أعيد حلها بصورة مستقلة). المعتمد وحده يدخل الاختبار؛ والمرفوض يُذكر سببه.
 * المعرّف من itemId(bookId, sectionId, نص السؤال)، فتعديل السؤال يلغي اعتماده تلقائياً.
 */
export interface SubjectReview {
  approved: string[]
  rejected: Record<string, string>
}
export const PLACEMENT_REVIEW: Record<string, SubjectReview> = {
  "الرياضيات": {
    "approved": [
      "147575-23-1ajfy7z",
      "147575-23-1xyh89x",
      "6068fb-17-37y0dc",
      "6068fb-17-1x6ic8u",
      "6068fb-17-iwd0wl",
      "6068fb-31-nw8y4z",
      "6068fb-38-1ovn56q",
      "6068fb-38-gjv0ne",
      "6068fb-38-gxbmrg",
      "b38978-5-1oer29t",
      "b38978-5-1jxda2y",
      "b38978-5-g4xzjl",
      "147575-26-qrqap4",
      "147575-26-nxkptv",
      "147575-26-1ohaztz",
      "147575-26-1chno5m",
      "147575-26-at2cs",
      "6068fb-17-cbcnv0",
      "6068fb-17-udha4p",
      "6068fb-17-18uck0c",
      "6068fb-17-1wv6jzh",
      "6068fb-17-xbwhk"
    ],
    "rejected": {
      "6068fb-6-bjmjac": "خيارات تحمل حروف ترتيب (أ، ب…) لا تطابق موضعها بعد خلط الخيارات"
    }
  },
  "الفيزياء": {
    "approved": [
      "5bf8f3-2-18ng1sr",
      "5bf8f3-17-b21wkw",
      "5bf8f3-20-19xnfcy",
      "5bf8f3-20-yqsxdc",
      "5bf8f3-4-17x3rxt",
      "5bf8f3-4-bte7sv",
      "5bf8f3-12-1cj80s",
      "5bf8f3-15-75epp8",
      "5bf8f3-19-1rm8qh2",
      "5bf8f3-6-5de8h6",
      "5bf8f3-6-zev35q",
      "5bf8f3-16-1gunv76",
      "5bf8f3-11-19ifpah"
    ],
    "rejected": {
      "5bf8f3-8-1m6byb9": "«الطول الموجي فقط» غير دقيق: سرعة الضوء تتغير أيضاً عند الانتقال إلى الزجاج",
      "5bf8f3-8-182vkyg": "معلومة تاريخية (كتاب المناظر) لا تقيس الفهم"
    }
  }
}
