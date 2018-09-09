SUBmersible WARship 2063
========================

My game entry for JS13K Games 2018 on the theme "Offline", and tribute to Micropose's 1993 submarine simulator Subwar 2050.

Special thanks to [Mark Sparling](https://twitter.com/markymark665) who composed the  musical track on [Soundbox](http://sb.bitsnbites.eu/?data=U0JveAwC7dzLaxNBHMDx306227Raa2zWR6ttan2ilkotolZ68FFQCr4QhQpCoYpFVFSsenCxh4CPlhKV2iD14EHQi6eCVw_qSfHg31AEL_4DddokNk4ei9bFkH4_m9_OzuxkMlmyy2aW3d0RkTUSC6vznoS-eaJFW_TsnWOpyTHZnrDP2ZYqNsV17WEdIzoSOsx80NzM3BV37jWndna9nkdkWVTclbKqQRqbmtdv2rKtvWPn7k6zv090jOtI6pjI-4n_1kz_3bxmvpFIl17ffex079m-_oFLVwfvDMUfjj5OTrx4-VreyKRf6wAAAAAAAAAAAPhT6rMn6qNn6cVH-_RsqVhKBjuaI_YJRyRkZ09V1euycn4tI1iX_CoEzE1dqRQ39_rfbImllISULRXiOE5luDJcXVMbiS5fWb-6SVo2tbaVQP-Lauvac6Dn1Nn-K0Mjz16-fTc40Husu7N1Y2PdogpbWX6tA-Xthl-FgLnzPP6UQP-L4vgDAAAAIOORXwUAAEqQOf52M2-t4LjzHD9Uhz1RJ7ywyOK3e1NNKumR2PHQXVukwsmeKsNrs3LF-wWUtz6_CgHL2d8zu3x6UdlO1ZJofdOG1rb2jp17DnQf6jkip_ouXLkVv594-qzk-m8W_Pg-9fXD5Ivk6NBg_8nurl2yo23rusYVkZpqx1aWJQN-HxAws__Gd_Dd_qXW_z_d_gAAAAAAAEApM8ffLuatFRxz_M0Yg_MdP8R_tsuTkI6Zq2Q9knpaY51IbNr5NDs4urox_1S0TQAAAAAAAAALXNyn_F6B9Zny4QLrR9Lp7QLrC5UvNEFt_wfplO0PoFwpmX1ao16qdaJ6fsa2QgffV8fuquacu8pq0nIaAQAAWBCS408SxcLv_QAAAAAAAH4SyfFfr4nUoMNveb_3Y56ee5YOsb7YlZt1ttO21LRIbG9F7NeVs2ZDkdYAAAAAAAAAAEBZMO9dLHQvI1BWpq9ZOsQS22lJlaglIrHsKg21v095WgEAAAAClvuPLZ6nFAAAoHzkG7Hm7AcAgGCp655YvZ6Sukh0v863K0tNXZbYq9BRO7teS1Pdqpko0AwAAAAAIDCZx7GMpdPH6XQ0nSaMdNhIAeBvjfuk5vFn1EgB4G8VOt5kzoM4_0E5M3_fZmruH2NGivn5CQ), [Florent Cailhol](https://twitter.com/ooflorent) who introduced me to Entity-Component-Systems and contributed some code optimizations, and [Andrzej Mazur](https://twitter.com/end3r) for running the JS13K Games competition year over year.

Goal
----
Enemy submarines have invaded your perimeter. Fight back and sink them all!

Turn your sonar online to locate your enemies, but beware that it gives your position away! Turn your sonar offline to disappear from their radar, and them from yours...

Controls
--------
Arrow/WASD (ZQSD on French keyboard): Move your submarine.
Space: Fire a torpedo.

F or O: Toggle your sonar online or offline.

P: Pause or resume the game.

Developer's corner
==================

```
npm start
```
This command builds game, opens a browser, watches the source code and livereloads the browser when source code changes.

```
npm run build
```
This command builds the game for submission (no sourcemap nor livereload script)

Special Thanks and Attributions
--------------
- Eoin McGrath for his original build script
- [Peters](https://twitter.com/p1100i) and [flo-](https://twitter.com/fl0ptimus_prime) for their pixel font from Glitch Hunter
- [Ryan Malm](https://twitter.com/ryanmalm) for sharing his Twitter message code
- [Maxime Euziere](https://twitter.com/MaximeEuziere) for his switch/case approach to handling game screens in update/render/input handlers
- [Florent Cailhol](https://twitter.com/ooflorent) for suggesting Terser in place of UglifyJS
- Marcus Geelnard for creating music tracker & player [SoundBox](https://github.com/mbitsnbites/soundbox)
