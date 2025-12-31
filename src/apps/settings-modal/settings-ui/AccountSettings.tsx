// src/apps/settings-modal/settings-ui/AccountSettings.tsx

import * as React from 'react';

import { Box, Button, Typography } from '@mui/joy';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { useSession } from 'next-auth/react';

import { GoodModal } from '~/common/components/modals/GoodModal';


export function AccountSettings(props: { onRequestCloseSettings: () => void }) {
  const { data: session } = useSession();

  const username = session?.user?.name || 'Unknown';
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = !!(session?.user as any)?.isAdmin;

  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const handleBeginLogout = React.useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const handleCancelLogout = React.useCallback(() => {
    setConfirmOpen(false);
  }, []);

  const handleConfirmLogout = React.useCallback(() => {
    setConfirmOpen(false);
    props.onRequestCloseSettings();

    // Hard navigation is intentional: it creates a reload boundary so middleware can
    // update ew_uid and Zustand persist keys re-initialize under the new namespace.
    window.location.assign('/logout');
  }, [props]);

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

        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Button
            variant='soft'
            color='danger'
            startDecorator={<LogoutIcon />}
            onClick={handleBeginLogout}
          >
            Log out
          </Button>
        </Box>
      </Box>

      {/* Confirmation dialog (simple: Log out / Cancel) */}
      <GoodModal
        open={confirmOpen}
        title='Logout'
        themedColor='neutral'
        onClose={handleCancelLogout}
        closeText='Cancel'
        startButton={
          <Button
            variant='solid'
            color='danger'
            onClick={handleConfirmLogout}
            startDecorator={<LogoutIcon />}
          >
            Log out
          </Button>
        }
      >
        <Typography level='body-sm'>
          Are you sure you want to log out?
        </Typography>
      </GoodModal>
    </>
  );
}