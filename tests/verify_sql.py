import sqlite3
from pathlib import Path
cx=sqlite3.connect(':memory:')
cx.execute('PRAGMA foreign_keys=ON')
cx.executescript((Path(__file__).parents[1]/'migrations/0001_portal_aph.sql').read_text())
assert cx.execute('SELECT revision FROM catalog_meta').fetchone()==(0,)
# Successful initial CAS + guard + insert in one transaction
with cx:
 cx.execute("UPDATE catalog_meta SET revision=1,write_nonce='first' WHERE id=1 AND revision=0")
 cx.execute("INSERT INTO revision_guard(id,nonce) VALUES(1,'first')")
 cx.execute("INSERT INTO courses(id,title,position) VALUES('curso-1','Curso',0)")
 cx.execute("INSERT INTO modules(id,course_id,title,position) VALUES('mod-1','curso-1','Modulo',0)")
 cx.execute("INSERT INTO videos(module_id,youtube_id,title,url,position) VALUES('mod-1','1K_9oO79xb4','Video','https://www.youtube.com/watch?v=1K_9oO79xb4',0)")
assert cx.execute('select count(*) from videos').fetchone()[0]==1
# An old revision must fail and roll back the entire batch.
try:
 with cx:
  cx.execute("UPDATE catalog_meta SET revision=revision+1,write_nonce='stale' WHERE id=1 AND revision=0")
  cx.execute("INSERT INTO revision_guard(id,nonce) VALUES(1,'stale') ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce")
  cx.execute("DELETE FROM courses")
 raise AssertionError('Stale write accepted')
except sqlite3.IntegrityError as e:
 assert 'CATALOG_CONFLICT' in str(e)
assert cx.execute('select revision from catalog_meta').fetchone()==(1,)
assert cx.execute('select count(*) from courses').fetchone()[0]==1
# Another edit passes, and FK cascade removes children.
with cx:
 cx.execute("UPDATE catalog_meta SET revision=2,write_nonce='second' WHERE id=1 AND revision=1")
 cx.execute("INSERT INTO revision_guard(id,nonce) VALUES(1,'second') ON CONFLICT(id) DO UPDATE SET nonce=excluded.nonce")
 cx.execute("DELETE FROM courses WHERE id='curso-1'")
assert cx.execute('select count(*) from modules').fetchone()[0]==0
assert cx.execute('select count(*) from videos').fetchone()[0]==0
print('PASS: schema, atomic revision guard, stale transaction rollback, FK cascade')
