-- S5: the browser used these event types, but the migration-built enum lacked
-- them. Commit enum additions before 0055 uses them in event notifications.
alter type public.notification_type add value if not exists 'attendance_update';
alter type public.notification_type add value if not exists 'journal_submitted';
alter type public.notification_type add value if not exists 'evaluation_submitted';
alter type public.notification_type add value if not exists 'intern_status';
