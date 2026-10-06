import type { Category } from '../lib/categories';

type Props = {
  id: string;
  categories: readonly Category[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  testId: string;
};

export default function CategorySelect({ id, categories, value, onChange, disabled, testId }: Props) {
  const known = value === null || categories.some((c) => c.id === value);
  return (
    <>
      <label className="field-label" htmlFor={id}>カテゴリ</label>
      <select id={id} className="title-input category-select" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value || null)} data-testid={testId}>
        <option value="">カテゴリなし（未分類）</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        {!known && <option value={value!}>読み込み中のカテゴリ</option>}
      </select>
    </>
  );
}
