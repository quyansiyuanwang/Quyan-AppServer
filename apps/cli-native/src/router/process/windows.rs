//! Start an independent service without inheriting the caller's capture pipes.
use anyhow::{Context, Result};
use std::{
    io,
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
    },
    ptr,
};
use windows_sys::Win32::{
    Foundation::{WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{
        CreateProcessW, WaitForSingleObject, CREATE_NO_WINDOW, INFINITE, PROCESS_INFORMATION,
        STARTUPINFOW,
    },
};

pub(super) struct Child {
    handle: OwnedHandle,
    pid: u32,
}
impl Child {
    pub fn id(&self) -> u32 {
        self.pid
    }
    pub fn try_wait(&mut self) -> io::Result<Option<()>> {
        // SAFETY: the owned process handle remains valid throughout the wait.
        match unsafe { WaitForSingleObject(self.handle.as_raw_handle(), 0) } {
            WAIT_OBJECT_0 => Ok(Some(())),
            WAIT_TIMEOUT => Ok(None),
            _ => Err(io::Error::last_os_error()),
        }
    }
    pub fn wait(&mut self) -> io::Result<()> {
        // SAFETY: the owned process handle remains valid throughout the wait.
        if unsafe { WaitForSingleObject(self.handle.as_raw_handle(), INFINITE) } == WAIT_FAILED {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
}
pub(super) fn spawn() -> Result<Child> {
    let executable = std::env::current_exe()?;
    let application: Vec<u16> = executable.as_os_str().encode_wide().chain([0]).collect();
    // The application path is OS-provided; both arguments are fixed literals.
    let mut command = vec![b'"' as u16];
    command.extend(executable.as_os_str().encode_wide());
    command.extend("\" router serve\0".encode_utf16());
    let startup = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
    let mut process = PROCESS_INFORMATION::default();
    // SAFETY: all buffers remain live for the call; output structs have the documented
    // layout. No handles are inherited, and environment/current directory use OS defaults.
    let created = unsafe {
        CreateProcessW(
            application.as_ptr(),
            command.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            0,
            CREATE_NO_WINDOW,
            ptr::null(),
            ptr::null(),
            &startup,
            &mut process,
        )
    };
    if created == 0 {
        return Err(io::Error::last_os_error()).context("Cannot start Router");
    }
    // SAFETY: successful CreateProcessW gives us ownership of these two handles.
    let (handle, thread) = unsafe {
        (
            OwnedHandle::from_raw_handle(process.hProcess),
            OwnedHandle::from_raw_handle(process.hThread),
        )
    };
    drop(thread);
    Ok(Child {
        handle,
        pid: process.dwProcessId,
    })
}
