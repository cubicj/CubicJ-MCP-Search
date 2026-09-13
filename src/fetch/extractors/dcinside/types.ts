export interface User {
  name: string;
  userId: string | null;
  ip: string | null;
}

export interface ArticleDetail {
  galleryId: string;
  galleryName: string;
  index: number;
  title: string;
  header: string | null;
  time: Date;
  user: User;
  view: number;
  recommend: number;
  body: string;
  isMinor: boolean;
}

export interface Comment {
  index: number;
  body: string;
  user: User;
  time: Date;
}

export interface CommentListResult {
  totalPage: number;
  comments: Comment[];
}
