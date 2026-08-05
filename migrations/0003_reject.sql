-- 0003_reject.sql
-- 反馈/驳回闭环：订单增加 feedback_reason 字段（存预置原因 code），状态允许 REJECTED
ALTER TABLE orders ADD COLUMN feedback_reason TEXT NOT NULL DEFAULT '';
