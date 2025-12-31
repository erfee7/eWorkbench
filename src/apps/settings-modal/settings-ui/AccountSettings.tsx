// src/apps/settings-modal/settings-ui/AccountSettings.tsx

import * as React from 'react';

import { Box, Button, FormControl, FormLabel, Input, Typography } from '@mui/joy';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import LockResetIcon from '@mui/icons-material/LockReset';
import LogoutIcon from '@mui/icons-material/Logout';
import { useSession } from 'next-auth/react';

import { PASSWORD_MIN_LEN } from '~/common/auth/passwordPolicy';
import { GoodModal } from '~/common/components/modals/GoodModal';
import { purgeLocalChatAndSyncMetadataForCurrentUser } from '~/common/privacy/purgeLocalUserData';


export function AccountSettings(props: { onRequestCloseSettings: () => void }) {
  const { data: session } = useSession();

  const username = session?.user?.name || 'Unknown';
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = !!(session?.user as any)?.isAdmin;

  const [confirmLogoutOpen, setConfirmLogoutOpen] = React.useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = React.useState(false);

  const [isClearing, setIsClearing] = React.useState(false);
  const [clearError, setClearError] = React.useState<string | null>(null);

  const [changePwOpen, setChangePwOpen] = React.useState(false);
  const [oldPw, setOldPw] = React.useState('');
  const [newPw, setNewPw] = React.useState('');
  const [newPw2, setNewPw2] = React.useState('');
  const [pwBusy, setPwBusy] = React.useState(false);
  const [pwError, setPwError] = React.useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = React.useState<string | null>(null);

  const handleBeginLogout = React.useCallback(() => {
    setConfirmLogoutOpen(true);
  }, []);

  const handleCancelLogout = React.useCallback(() => {
    setConfirmLogoutOpen(false);
  }, []);

  const handleConfirmLogout = React.useCallback(() => {
    setConfirmLogoutOpen(false);
    props.onRequestCloseSettings();

    // Hard navigation is intentional: it creates a reload boundary so middleware can
    // update ew_uid and Zustand persist keys re-initialize under the new namespace.
    window.location.assign('/logout');
  }, [props]);

  const handleBeginClearAndLogout = React.useCallback(() => {
    setClearError(null);
    setConfirmClearOpen(true);
  }, []);

  const handleCancelClearAndLogout = React.useCallback(() => {
    if (isClearing) return;
    setConfirmClearOpen(false);
    setClearError(null);
  }, [isClearing]);

  const handleConfirmClearAndLogout = React.useCallback(async () => {
    if (isClearing) return;

    setIsClearing(true);
    setClearError(null);

    try {
      // Important: storage-level purge only (no app-level deletes) so it won't enqueue cloud deletes.
      await purgeLocalChatAndSyncMetadataForCurrentUser();

      setConfirmClearOpen(false);
      props.onRequestCloseSettings();

      // After purge completes, logout with a hard navigation boundary.
      window.location.assign('/logout');
    } catch (error: any) {
      setClearError(error?.message || 'Failed to clear local data.');
    } finally {
      setIsClearing(false);
    }
  }, [isClearing, props]);

  const handleLogoutAnywayAfterClearFail = React.useCallback(() => {
    setConfirmClearOpen(false);
    props.onRequestCloseSettings();
    window.location.assign('/logout');
  }, [props]);


  // ---- Change password ----

  const handleOpenChangePassword = React.useCallback(() => {
    setPwError(null);
    setPwSuccess(null);
    setOldPw('');
    setNewPw('');
    setNewPw2('');
    setChangePwOpen(true);
  }, []);

  const handleCloseChangePassword = React.useCallback(() => {
    if (pwBusy) return;
    setChangePwOpen(false);
  }, [pwBusy]);

  const handleSubmitChangePassword = React.useCallback(async () => {
    if (pwBusy) return;

    setPwError(null);
    setPwSuccess(null);

    // Quick client-side validation (server enforces too).
    if (!oldPw || !newPw || !newPw2) {
      setPwError('Please fill all fields.');
      return;
    }
    if (newPw.length < PASSWORD_MIN_LEN) {
      setPwError(`New password is too short (min ${PASSWORD_MIN_LEN}).`);
      return;
    }
    if (newPw !== newPw2) {
      setPwError('New passwords do not match.');
      return;
    }
    if (newPw === oldPw) {
      setPwError('New password must be different from the old password.');
      return;
    }

    setPwBusy(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: oldPw,
          newPassword: newPw,
          newPasswordConfirm: newPw2,
        }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        setPwError(retryAfter
          ? `Too many attempts. Try again in ${retryAfter}s.`
          : 'Too many attempts. Please try again later.');
        return;
      }

      if (!res.ok || !data?.ok) {
        // Keep it user-friendly; don't overexplain server internals.
        if (res.status === 401) {
          setPwError('Old password is incorrect (or your session expired).');
        } else if (data?.error === 'new_password_too_short') {
          setPwError(`New password is too short (min ${PASSWORD_MIN_LEN}).`);
        } else if (data?.error === 'new_password_mismatch') {
          setPwError('New passwords do not match.');
        } else {
          setPwError('Failed to change password.');
        }
        return;
      }

      setPwSuccess('Password updated.');
      setOldPw('');
      setNewPw('');
      setNewPw2('');
    } finally {
      setPwBusy(false);
    }
  }, [oldPw, newPw, newPw2, pwBusy]);

  return (
    <>
      <Box sx={{ display: 'grid', gap: 2, p: { xs: 1.5, md: 2.5 } }}>
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography level='body-sm' sx={{ color: 'text.secondary' }}>
            Signed in as
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography level='title-md'>
              {username}
            </Typography>

            {isAdmin && (
              <AdminPanelSettingsOutlinedIcon
                titleAccess='Admin'
                style={{ fontSize: 18 }}
              />
            )}
          </Box>
        </Box>

        {!!userId && (
          <Box sx={{ display: 'grid', gap: 0.25 }}>
            <Typography level='body-xs' sx={{ color: 'text.secondary' }}>
              User ID
            </Typography>
            <Typography
              level='body-xs'
              sx={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                wordBreak: 'break-all',
              }}
            >
              {userId}
            </Typography>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant='soft'
            color='neutral'
            startDecorator={<LockResetIcon />}
            onClick={handleOpenChangePassword}
            disabled={isClearing}
          >
            Change password
          </Button>

          <Button
            variant='soft'
            color='danger'
            startDecorator={<LogoutIcon />}
            onClick={handleBeginLogout}
            disabled={isClearing}
          >
            Log out
          </Button>

          <Button
            variant='solid'
            color='danger'
            startDecorator={<DeleteForeverIcon />}
            onClick={handleBeginClearAndLogout}
            disabled={isClearing}
          >
            Clear local data &amp; log out
          </Button>
        </Box>
      </Box>

      {/* Confirmation dialog: Log out */}
      <GoodModal
        open={confirmLogoutOpen}
        title='Logout'
        themedColor='neutral'
        onClose={(_event, _reason) => handleCancelLogout()}
        hideBottomClose
      >
        <Typography level='body-sm'>
          Are you sure you want to log out?
        </Typography>

        {/* Centered actions (avoid GoodModal footer space-between layout) */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2, flexWrap: 'wrap' }}>
          <Button
            variant='solid'
            color='danger'
            onClick={handleConfirmLogout}
            startDecorator={<LogoutIcon />}
          >
            Log out
          </Button>
          <Button
            variant='soft'
            color='neutral'
            onClick={handleCancelLogout}
          >
            Cancel
          </Button>
        </Box>
      </GoodModal>

      {/* Confirmation dialog: Clear local data + log out */}
      <GoodModal
        open={confirmClearOpen}
        title='Clear local data'
        themedColor='neutral'
        onClose={(_event, _reason) => handleCancelClearAndLogout()}
        hideBottomClose
        disableBackdropClose={isClearing}
        disableEscapeKeyClose={isClearing}
      >
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography level='body-sm'>
            This will remove your local chat history and sync metadata from this browser.
          </Typography>
          <Typography level='body-sm'>
            It will <b>not</b> delete anything from the server.
          </Typography>

          {!!clearError && (
            <Typography level='body-sm' color='danger'>
              {clearError}
            </Typography>
          )}

          {/* Centered actions (avoid GoodModal footer space-between layout) */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button
              variant='solid'
              color='danger'
              onClick={handleConfirmClearAndLogout}
              startDecorator={<DeleteForeverIcon />}
              disabled={isClearing}
            >
              {isClearing ? 'Clearing…' : 'Clear local data & log out'}
            </Button>

            <Button
              variant='soft'
              color='neutral'
              onClick={handleCancelClearAndLogout}
              disabled={isClearing}
            >
              Cancel
            </Button>

            {!!clearError && !isClearing && (
              <Button
                variant='soft'
                color='danger'
                onClick={handleLogoutAnywayAfterClearFail}
                startDecorator={<LogoutIcon />}
              >
                Log out anyway
              </Button>
            )}
          </Box>
        </Box>
      </GoodModal>

      {/* Change password dialog */}
      <GoodModal
        open={changePwOpen}
        title='Change password'
        themedColor='neutral'
        onClose={(_event, _reason) => handleCloseChangePassword()}
        hideBottomClose
        disableBackdropClose={pwBusy}
        disableEscapeKeyClose={pwBusy}
      >
        <Box sx={{ display: 'grid', gap: 1.5 }}>
          <FormControl>
            <FormLabel>Old password</FormLabel>
            <Input
              type='password'
              autoComplete='current-password'
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              disabled={pwBusy}
            />
          </FormControl>

          <FormControl>
            <FormLabel>New password</FormLabel>
            <Input
              type='password'
              autoComplete='new-password'
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pwBusy}
            />
          </FormControl>

          <FormControl>
            <FormLabel>Confirm new password</FormLabel>
            <Input
              type='password'
              autoComplete='new-password'
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              disabled={pwBusy}
            />
          </FormControl>

          <Typography level='body-xs' sx={{ color: 'text.secondary' }}>
            Minimum length: {PASSWORD_MIN_LEN}
          </Typography>

          {!!pwError && (
            <Typography level='body-sm' color='danger'>
              {pwError}
            </Typography>
          )}

          {!!pwSuccess && (
            <Typography level='body-sm' color='success'>
              {pwSuccess}
            </Typography>
          )}

          {/* Centered actions: keep buttons visually grouped */}
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <Button
              variant='solid'
              color='primary'
              onClick={handleSubmitChangePassword}
              startDecorator={<LockResetIcon />}
              disabled={pwBusy}
            >
              {pwBusy ? 'Updating…' : 'Change password'}
            </Button>

            <Button
              variant='soft'
              color='neutral'
              onClick={handleCloseChangePassword}
              disabled={pwBusy}
            >
              Close
            </Button>
          </Box>
        </Box>
      </GoodModal>
    </>
  );
}