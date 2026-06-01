import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type FoodRecipeType = 'PRAAD' | 'SUPP' | 'MAGUSTOIT';

export interface FoodIngredient {
  id: number;
  name: string;
  baseAmount: number;
  unit: string;
}

export interface FoodRecipe {
  id: number;
  ownerId?: number | null;
  name: string;
  type: FoodRecipeType;
  instructions: string;
  baseServings: number;
  cost: number;
  ingredients: FoodIngredient[];
  averageRating: number;
  ratingCount: number;
  myRating: number | null;
}

export interface FoodCalendarEntry {
  id: number;
  date: string;
  recipe: FoodRecipe;
}

export interface FoodWeek {
  weekStart: string;
  entries: FoodCalendarEntry[];
}

interface ApiResponse<T> {
  data: T;
}

interface CreateRecipePayload {
  name: string;
  type: FoodRecipeType;
  instructions: string;
  baseServings: number;
  cost: number;
  ingredients: Array<{ name: string; baseAmount: number; unit: string }>;
}

interface UpdateRecipePayload extends Partial<CreateRecipePayload> {}
interface UpdateRecipeWithOwnerPayload extends UpdateRecipePayload {
  ownerId?: number;
}

interface CreateCalendarPayload {
  date: string;
  recipeId: number;
}

interface UpdateCalendarPayload {
  date: string;
}

interface SaveRatingPayload {
  rating: number;
}

@Injectable({ providedIn: 'root' })
export class FoodPlanService {
  private readonly http = inject(HttpClient);

  getRecipes(type?: FoodRecipeType | null, search?: string): Observable<FoodRecipe[]> {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (search?.trim()) params.set('search', search.trim());

    return this.http.get<ApiResponse<FoodRecipe[]>>(`${environment.apiUrl}/food-plans/recipes${params.size ? `?${params.toString()}` : ''}`).pipe(
      map((response) => response.data)
    );
  }

  getRecipe(id: number): Observable<FoodRecipe> {
    return this.http.get<ApiResponse<FoodRecipe>>(`${environment.apiUrl}/food-plans/recipes/${id}`).pipe(map((response) => response.data));
  }

  createRecipe(payload: CreateRecipePayload): Observable<FoodRecipe> {
    return this.http.post<ApiResponse<FoodRecipe>>(`${environment.apiUrl}/food-plans/recipes`, payload).pipe(map((response) => response.data));
  }

  updateRecipe(id: number, payload: UpdateRecipeWithOwnerPayload): Observable<FoodRecipe> {
    return this.http.put<ApiResponse<FoodRecipe>>(`${environment.apiUrl}/food-plans/recipes/${id}`, payload).pipe(map((response) => response.data));
  }

  deleteRecipe(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/food-plans/recipes/${id}`).pipe(map(() => void 0));
  }

  getWeek(from: string): Observable<FoodWeek> {
    return this.http.get<ApiResponse<FoodWeek>>(`${environment.apiUrl}/food-plans/calendar/week?from=${encodeURIComponent(from)}`).pipe(
      map((response) => response.data)
    );
  }

  addToCalendar(payload: CreateCalendarPayload): Observable<FoodCalendarEntry> {
    return this.http.post<ApiResponse<FoodCalendarEntry>>(`${environment.apiUrl}/food-plans/calendar`, payload).pipe(map((response) => response.data));
  }

  moveCalendarEntry(id: number, payload: UpdateCalendarPayload): Observable<FoodCalendarEntry> {
    return this.http.patch<ApiResponse<FoodCalendarEntry>>(`${environment.apiUrl}/food-plans/calendar/${id}`, payload).pipe(map((response) => response.data));
  }

  deleteCalendarEntry(id: number): Observable<void> {
    return this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/food-plans/calendar/${id}`).pipe(map(() => void 0));
  }

  saveRating(recipeId: number, rating: number): Observable<void> {
    return this.http.post<ApiResponse<unknown>>(`${environment.apiUrl}/food-plans/recipes/${recipeId}/rating`, { rating }).pipe(map(() => void 0));
  }
}
