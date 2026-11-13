-- Thomas named the assistant (and the app) MyManager.
alter table settings alter column assistant_name set default 'MyManager';
update settings set assistant_name = 'MyManager' where assistant_name = 'Manager';
