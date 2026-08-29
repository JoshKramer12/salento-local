export type SearchSuggestionType =
  | "business"
  | "keyword"
  | "locality"
  | "search"
  | "town";

export type SearchSuggestion = {
  href: string;
  id: string;
  subtitle?: string;
  title: string;
  type: SearchSuggestionType;
};
