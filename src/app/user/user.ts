import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { environment } from '../../environments/environment';
import { TranslationService } from '../i18n/translation.service';

interface UserSummary {
  id: number;
  username: string;
  role: 'ADMIN' | 'PARENT' | 'CHILD';
  status: 'ACTIVE' | 'PENDING';
}

interface ApiResponse<T> {
  data: T;
}

@Component({
  selector: 'app-user',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './user.html',
  styleUrl: './user.css'
})
export class User implements OnInit {
  private readonly formBuilder = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  readonly authService = inject(AuthService);
  readonly i18n = inject(TranslationService);

  activeSection: 'details' | 'family-member' | 'all-users' = 'details';
  feedbackMessage = '';
  errorMessage = '';
  memberFeedbackMessage = '';
  memberErrorMessage = '';
  usersFeedbackMessage = '';
  usersErrorMessage = '';
  isSaving = false;
  isCreatingMember = false;
  isLoadingUsers = false;
  isSavingSelectedUser = false;
  isDeletingSelectedUser = false;
  usersLoaded = false;
  users: UserSummary[] = [];
  selectedUserId: number | null = null;

  readonly userDetailsForm = this.formBuilder.group({
    username: [this.authService.getUsername() ?? '', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.minLength(4), Validators.maxLength(100)]]
  });

  readonly familyMemberForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(100)]],
    role: ['PARENT', Validators.required]
  });

  readonly selectedUserForm = this.formBuilder.nonNullable.group({
    username: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.minLength(4), Validators.maxLength(100)]],
    role: ['PARENT' as UserSummary['role'], Validators.required]
  });

  ngOnInit(): void {
    this.selectedUserForm.controls.role.disable();
  }

  selectSection(section: 'details' | 'family-member' | 'all-users'): void {
    this.activeSection = section;
    this.feedbackMessage = '';
    this.errorMessage = '';
    this.memberFeedbackMessage = '';
    this.memberErrorMessage = '';
    this.usersFeedbackMessage = '';
    this.usersErrorMessage = '';

    if (section === 'all-users' && this.authService.isAdmin() && !this.usersLoaded) {
      this.loadUsers();
    }
  }

  saveUserDetails(): void {
    const userId = this.authService.getUserId();
    if (!userId) {
      this.errorMessage = this.i18n.translate('user.userNotFound');
      return;
    }

    if (this.userDetailsForm.invalid || this.isSaving) {
      this.userDetailsForm.markAllAsTouched();
      return;
    }

    const { username, password } = this.userDetailsForm.getRawValue();
    const payload: { username?: string; password?: string } = {};

    if (username && username !== this.authService.getUsername()) {
      payload.username = username;
    }

    if (password) {
      payload.password = password;
    }

    if (Object.keys(payload).length === 0) {
      this.feedbackMessage = this.i18n.translate('user.noChanges');
      this.errorMessage = '';
      return;
    }

    this.feedbackMessage = '';
    this.errorMessage = '';
    this.isSaving = true;

    this.http.put(`${environment.apiUrl}/users/${userId}`, payload)
      .pipe(finalize(() => {
        this.isSaving = false;
      }))
      .subscribe({
        next: () => {
          if (payload.username && payload.password) {
            this.authService.updateCredentials(payload.username, payload.password);
            this.userDetailsForm.patchValue({ password: '' });
            this.feedbackMessage = this.i18n.translate('user.updateSuccess');
            return;
          }

          if (payload.username) {
            this.authService.updateUsername(payload.username);
            this.userDetailsForm.patchValue({ password: '' });
            this.feedbackMessage = this.i18n.translate('user.updateSuccess');
            return;
          }

          if (payload.password) {
            this.authService.updateCredentials(this.authService.getUsername() ?? username ?? '', payload.password);
            return;
          }

          this.userDetailsForm.patchValue({ password: '' });
          this.feedbackMessage = this.i18n.translate('user.updateSuccess');
        },
        error: (error: HttpErrorResponse) => {
          this.errorMessage = error.error?.message || this.i18n.translate('user.updateFailed');
        }
      });
  }

  createFamilyMember(): void {
    if (!this.authService.isAdmin()) {
      return;
    }

    if (this.familyMemberForm.invalid || this.isCreatingMember) {
      this.familyMemberForm.markAllAsTouched();
      return;
    }

    this.memberFeedbackMessage = '';
    this.memberErrorMessage = '';
    this.isCreatingMember = true;

    this.http.post(`${environment.apiUrl}/users`, this.familyMemberForm.getRawValue())
      .pipe(finalize(() => {
        this.isCreatingMember = false;
      }))
      .subscribe({
        next: () => {
          this.familyMemberForm.reset({
            username: '',
            password: '',
            role: 'PARENT'
          });
          this.memberFeedbackMessage = this.i18n.translate('user.memberCreateSuccess');
          this.usersLoaded = false;
          if (this.activeSection === 'all-users') {
            this.loadUsers();
          }
        },
        error: (error: HttpErrorResponse) => {
          this.memberErrorMessage = error.error?.message || this.i18n.translate('user.memberCreateFailed');
        }
      });
  }

  loadUsers(): void {
    if (!this.authService.isAdmin() || this.isLoadingUsers) {
      return;
    }

    this.usersErrorMessage = '';
    this.usersFeedbackMessage = '';
    this.isLoadingUsers = true;

    this.http.get<ApiResponse<UserSummary[]>>(`${environment.apiUrl}/users`)
      .pipe(finalize(() => {
        this.isLoadingUsers = false;
      }))
      .subscribe({
        next: (response) => {
          this.users = response.data;
          this.usersLoaded = true;

          const preferredUser = this.users.find(({ id }) => id === this.selectedUserId) ?? this.users[0];
          if (preferredUser) {
            this.selectUser(preferredUser);
            return;
          }

          this.selectedUserId = null;
          this.selectedUserForm.reset({
            username: '',
            password: '',
            role: 'PARENT'
          });
          this.selectedUserForm.controls.role.disable();
        },
        error: (error: HttpErrorResponse) => {
          this.usersErrorMessage = error.error?.message || this.i18n.translate('user.loadUsersFailed');
        }
      });
  }

  selectUser(user: UserSummary): void {
    this.selectedUserId = user.id;
    this.usersFeedbackMessage = '';
    this.usersErrorMessage = '';
    this.selectedUserForm.reset({
      username: user.username,
      password: '',
      role: user.role
    });

    if (user.role === 'ADMIN') {
      this.selectedUserForm.controls.role.disable();
    } else {
      this.selectedUserForm.controls.role.enable();
    }
  }

  saveSelectedUser(): void {
    if (!this.authService.isAdmin() || this.selectedUserId === null) {
      return;
    }

    if (this.selectedUserForm.invalid || this.isSavingSelectedUser) {
      this.selectedUserForm.markAllAsTouched();
      return;
    }

    const selectedUser = this.users.find(({ id }) => id === this.selectedUserId);
    if (!selectedUser) {
      this.usersErrorMessage = this.i18n.translate('user.selectedNotFound');
      return;
    }

    const { username, password, role } = this.selectedUserForm.getRawValue();
    const payload: { username?: string; password?: string; role?: UserSummary['role'] } = {};

    if (username && username !== selectedUser.username) {
      payload.username = username;
    }

    if (password) {
      payload.password = password;
    }

    if (selectedUser.role !== 'ADMIN' && role !== selectedUser.role) {
      payload.role = role;
    }

    if (Object.keys(payload).length === 0) {
      this.usersFeedbackMessage = this.i18n.translate('user.noChanges');
      this.usersErrorMessage = '';
      return;
    }

    this.usersFeedbackMessage = '';
    this.usersErrorMessage = '';
    this.isSavingSelectedUser = true;

    this.http.put<ApiResponse<UserSummary>>(`${environment.apiUrl}/users/${this.selectedUserId}`, payload)
      .pipe(finalize(() => {
        this.isSavingSelectedUser = false;
      }))
      .subscribe({
        next: (response) => {
          const updatedUser = response.data;
          this.users = this.users
            .map((user) => user.id === updatedUser.id ? updatedUser : user)
            .sort((left, right) => left.username.localeCompare(right.username, undefined, { sensitivity: 'base' }));
          this.selectUser(updatedUser);
          this.usersFeedbackMessage = this.i18n.translate('user.userUpdateSuccess');

          if (updatedUser.id === this.authService.getUserId()) {
            if (payload.username && payload.password) {
              this.authService.updateCredentials(updatedUser.username, payload.password);
              return;
            }

            if (payload.username) {
              this.authService.updateUsername(updatedUser.username);
              return;
            }

            if (payload.password) {
              this.authService.updateCredentials(updatedUser.username, payload.password);
            }
          }
        },
        error: (error: HttpErrorResponse) => {
          this.usersErrorMessage = error.error?.message || this.i18n.translate('user.userUpdateFailed');
        }
      });
  }

  deleteSelectedUser(): void {
    if (!this.authService.isAdmin() || this.selectedUserId === null || this.isDeletingSelectedUser) {
      return;
    }

    const selectedUser = this.users.find(({ id }) => id === this.selectedUserId);
    if (!selectedUser) {
      this.usersErrorMessage = this.i18n.translate('user.selectedNotFound');
      return;
    }

    if (selectedUser.role === 'ADMIN') {
      this.usersErrorMessage = this.i18n.translate('user.adminDeleteBlocked');
      return;
    }

    const confirmed = window.confirm(this.i18n.translate('user.deleteConfirm', { username: selectedUser.username }));
    if (!confirmed) {
      return;
    }

    this.usersFeedbackMessage = '';
    this.usersErrorMessage = '';
    this.isDeletingSelectedUser = true;

    this.http.delete<ApiResponse<string>>(`${environment.apiUrl}/users/${selectedUser.id}`)
      .pipe(finalize(() => {
        this.isDeletingSelectedUser = false;
      }))
      .subscribe({
        next: () => {
          this.users = this.users.filter((user) => user.id !== selectedUser.id);
          const nextSelectedUser = this.users[0];
          if (nextSelectedUser) {
            this.selectUser(nextSelectedUser);
          } else {
            this.selectedUserId = null;
            this.selectedUserForm.reset({
              username: '',
              password: '',
              role: 'PARENT'
            });
            this.selectedUserForm.controls.role.disable();
          }
          this.usersFeedbackMessage = this.i18n.translate('user.userDeleteSuccess');
        },
        error: (error: HttpErrorResponse) => {
          this.usersErrorMessage = error.error?.message || this.i18n.translate('user.userDeleteFailed');
        }
      });
  }

  getRoleLabel(role: UserSummary['role']): string {
    switch (role) {
      case 'ADMIN':
        return this.i18n.translate('user.roleAdmin');
      case 'CHILD':
        return this.i18n.translate('user.roleChild');
      default:
        return this.i18n.translate('user.roleParent');
    }
  }

  getStatusLabel(status: UserSummary['status']): string {
    return status === 'ACTIVE'
      ? this.i18n.translate('user.statusActive')
      : this.i18n.translate('user.statusPending');
  }
}
