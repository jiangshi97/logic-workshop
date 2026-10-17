// 本文件由 scripts/generate-level-data.mjs 生成，请勿手改。
// 修改 content/levels/*.json 后运行 npm run regen:levels 重新生成。
// 源文件（20 个）：001-wire.json、002-nand.json、003-not.json、004-and.json、005-or.json、006-xor.json、007-xnor.json、008-majority.json、009-mux.json、010-demux.json、011-join-bus.json、012-mux4.json、013-zero-detect.json、014-equal4.json、015-half-adder.json、016-full-adder.json、017-adder2.json、018-adder4.json、019-increment4.json、020-subtract4.json
export const levelData: unknown[] = [
  // 001-wire.json
  {"id":1,"title":"点亮信号灯","caption":"让信号抵达终点","goal":"输出 Y 始终与输入 A 相同。","formula":"Y = A","chapter":1,"inputs":[["A",1]],"outputs":[["Y",1]],"hints":["导线可以把输入信号传递到输出。","从 A 右侧的端口连接到 Y 左侧的端口。","直接连接 A 与 Y，不需要逻辑门。"],"combinational":{"expect":{"Y":"A"}}},
  // 002-nand.json
  {"id":2,"title":"认识 NAND","caption":"第一次逻辑运算","goal":"只有 A 和 B 都为 1 时，Y 才为 0。","formula":"Y = ¬(A ∧ B)","chapter":1,"inputs":[["A",1],["B",1]],"outputs":[["Y",1]],"hints":["NAND 是“与非”：先判断是否同时为 1，再反转结果。","NAND 有两个输入端口，分别接收 A 和 B。","放置一个 NAND，将 A、B 接入，再把它的输出接到 Y。"],"rewardName":"NAND","combinational":{"expect":{"Y":"~(A & B)"}}},
  // 003-not.json
  {"id":3,"title":"反向开关","caption":"把已有元件变成新工具","goal":"A 为 0 时 Y 为 1；A 为 1 时 Y 为 0。","formula":"Y = ¬A","chapter":1,"inputs":[["A",1]],"outputs":[["Y",1]],"hints":["观察 NAND 的两个输入相同时，会输出什么。","同一个输出端口可以连接到多个输入端口。","将 A 同时接到 NAND 的两个输入，再连接 NAND 的输出到 Y。"],"rewardName":"NOT","combinational":{"expect":{"Y":"~A"}}},
  // 004-and.json
  {"id":4,"title":"双人确认","caption":"组合出 AND","goal":"只有 A 和 B 都为 1 时，Y 才为 1。","formula":"Y = A ∧ B","chapter":1,"inputs":[["A",1],["B",1]],"outputs":[["Y",1]],"hints":["NAND 的结果和任务要求恰好相反。","上一关得到的 NOT 可以再次反转一个信号。","先将 A、B 接入 NAND，再通过 NOT 连接到 Y。也可以用两个 NAND 完成。"],"rewardName":"AND","combinational":{"expect":{"Y":"A & B"}}},
  // 005-or.json
  {"id":5,"title":"任一确认","caption":"组合出 OR","goal":"A、B 中至少一个为 1 时，Y 为 1。","formula":"Y = A ∨ B","chapter":2,"inputs":[["A",1],["B",1]],"outputs":[["Y",1]],"hints":["先反转两个输入，再观察 NAND 的结果。","德摩根关系把“或”转化为“与非”。","A、B 分别接 NOT，再接入同一个 NAND。"],"rewardName":"OR","combinational":{"expect":{"Y":"A | B"}}},
  // 006-xor.json
  {"id":6,"title":"不同才亮","caption":"组合出 XOR","goal":"仅当 A、B 不同时，Y 为 1。","formula":"Y = A ⊕ B","chapter":2,"inputs":[["A",1],["B",1]],"outputs":[["Y",1]],"hints":["把“至少一个 1”和“不能同时为 1”分别算出来。","OR 与 NAND 的结果可以通过 AND 合并。","将 OR(A,B) 与 NAND(A,B) 接入 AND。"],"rewardName":"XOR","combinational":{"expect":{"Y":"A ^ B"}}},
  // 007-xnor.json
  {"id":7,"title":"一致确认","caption":"组合出 XNOR","goal":"仅当 A、B 相同时，Y 为 1。","formula":"Y = ¬(A ⊕ B)","chapter":2,"inputs":[["A",1],["B",1]],"outputs":[["Y",1]],"hints":["上一关的 XOR 表示“不同”。","在 XOR 后增加一个反转即可表示“相同”。","XOR(A,B) 接入 NOT，再连接 Y。"],"rewardName":"XNOR","combinational":{"expect":{"Y":"~(A ^ B)"}}},
  // 008-majority.json
  {"id":8,"title":"多数表决","caption":"三人投票","goal":"A、B、C 至少两个为 1 时，Y 为 1。","formula":"Y = AB ∨ AC ∨ BC","chapter":2,"inputs":[["A",1],["B",1],["C",1]],"outputs":[["Y",1]],"hints":["列出所有两人同时同意的组合。","分别计算 AB、AC 和 BC。","把三个 AND 的结果通过 OR 合并。"],"rewardName":"多数表决","combinational":{"expect":{"Y":"A + B + C >= 2"}}},
  // 009-mux.json
  {"id":9,"title":"信号选择器","caption":"一位 MUX","goal":"S 为 0 时 Y=A；S 为 1 时 Y=B。","formula":"Y = (A ∧ ¬S) ∨ (B ∧ S)","chapter":2,"inputs":[["A",1],["B",1],["S",1]],"outputs":[["Y",1]],"hints":["S 控制 B 通路，反向的 S 控制 A 通路。","两条通路分别经过 AND，再通过 OR 合并。","NOT(S) 与 A 接 AND；S 与 B 接 AND；两个结果接 OR。"],"rewardName":"MUX","combinational":{"expect":{"Y":"S = 0 ? A : B"}}},
  // 010-demux.json
  {"id":10,"title":"信号分配器","caption":"一位 DEMUX","goal":"S 为 0 时 (Y0,Y1)=(A,0)；S 为 1 时 (Y0,Y1)=(0,A)。","formula":"Y0 = A ∧ ¬S；Y1 = A ∧ S","chapter":2,"inputs":[["A",1],["S",1]],"outputs":[["Y0",1],["Y1",1]],"hints":["两个输出分别控制 A 的一条通路。","两条通路需要相反的选择信号。","A 与 NOT(S) 接 AND 输出 Y0；A 与 S 接 AND 输出 Y1。"],"rewardName":"DEMUX","combinational":{"expect":{"Y0":"S = 0 ? A : 0","Y1":"S = 1 ? A : 0"}}},
  // 011-join-bus.json
  {"id":11,"title":"四位信号","caption":"组成一条总线","goal":"将 b0、b1、b2、b3 合成四位输出，b0 是最低位。","formula":"Y = b0 + 2b1 + 4b2 + 8b3","chapter":3,"inputs":[["b0",1],["b1",1],["b2",1],["b3",1]],"outputs":[["Y",4]],"hints":["JOIN 把单个信号合成总线。","第 0 位的权重为 1，第 3 位的权重为 8。","把 b0 至 b3 分别连接 JOIN 的 in0 至 in3。"],"combinational":{"expect":{"Y":"b0 + 2 * b1 + 4 * b2 + 8 * b3"}}},
  // 012-mux4.json
  {"id":12,"title":"四位选择器","caption":"并行复用 MUX","goal":"S 为 0 时 Y=A；S 为 1 时 Y=B，A、B、Y 均为四位数。","formula":"Y = S ? B : A","chapter":3,"inputs":[["A",4],["B",4],["S",1]],"outputs":[["Y",4]],"hints":["用 SPLIT 将 A、B 拆成对应的四个位。","四个位分别接入一位 MUX，它们共享 S。","将四个选择结果按相同位序接入 JOIN。"],"rewardName":"MUX4","combinational":{"expect":{"Y":"S = 0 ? A : B"}}},
  // 013-zero-detect.json
  {"id":13,"title":"零值检测","caption":"检查所有位","goal":"仅当四位输入 A 等于 0 时，Z 为 1。","formula":"Z = (A = 0)","chapter":3,"inputs":[["A",4]],"outputs":[["Z",1]],"hints":["零值意味着所有位都为 0。","将各个位 OR 起来可以判断是否存在一个 1。","SPLIT 拆位，通过 OR 合并四位，再用 NOT 反转。"],"rewardName":"Zero4","combinational":{"expect":{"Z":"A = 0"}}},
  // 014-equal4.json
  {"id":14,"title":"四位相等","caption":"逐位比较","goal":"仅当四位 A 与 B 相等时，EQ 为 1。","formula":"EQ = (A = B)","chapter":3,"inputs":[["A",4],["B",4]],"outputs":[["EQ",1]],"hints":["两个数字相等，需要每一对对应位都相等。","XOR 可以检测每一对位是否不同。","把四个 XOR 结果 OR 起来，再用 NOT 反转。"],"rewardName":"Equal4","combinational":{"expect":{"EQ":"A = B"}}},
  // 015-half-adder.json
  {"id":15,"title":"半加器","caption":"同时输出和与进位","goal":"Sum 是 A+B 的最低位，Carry 是进位。","formula":"Sum = A ⊕ B；Carry = A ∧ B","chapter":4,"inputs":[["A",1],["B",1]],"outputs":[["Sum",1],["Carry",1]],"hints":["两位相加时，结果可能需要两个输出位。","XOR 决定最低位，AND 决定进位。","A、B 同时接入 XOR 和 AND，分别输出 Sum 与 Carry。"],"rewardName":"HalfAdder","combinational":{"expect":{"Sum":"(A + B) mod 2","Carry":"(A + B) div 2"}}},
  // 016-full-adder.json
  {"id":16,"title":"全加器","caption":"接收上一级进位","goal":"将 A、B、Cin 相加，输出最低位 Sum 与进位 Cout。","formula":"Sum + 2Cout = A + B + Cin","chapter":4,"inputs":[["A",1],["B",1],["Cin",1]],"outputs":[["Sum",1],["Cout",1]],"hints":["用第一个半加器计算 A+B。","将其 Sum 与 Cin 接入第二个半加器。","第二个 Sum 是结果，两个 Carry 通过 OR 合并为 Cout。"],"rewardName":"FullAdder","combinational":{"expect":{"Sum":"(A + B + Cin) mod 2","Cout":"(A + B + Cin) div 2"}}},
  // 017-adder2.json
  {"id":17,"title":"两位加法","caption":"串联进位","goal":"计算两位 A+B+Cin，Sum 保留两位，Cout 表示溢出。","formula":"Sum + 4Cout = A + B + Cin","chapter":4,"inputs":[["A",2],["B",2],["Cin",1]],"outputs":[["Sum",2],["Cout",1]],"hints":["从最低位开始相加。","低位全加器的 Cout 接高位全加器的 Cin。","两个 Sum 按位序合成总线，高位 Cout 连接最终进位。"],"rewardName":"Adder2","combinational":{"expect":{"Sum":"(A + B + Cin) mod 4","Cout":"(A + B + Cin) div 4"}}},
  // 018-adder4.json
  {"id":18,"title":"四位加法","caption":"构建组合运算器","goal":"计算四位 A+B+Cin，Sum 保留四位，Cout 表示溢出。","formula":"Sum + 16Cout = A + B + Cin","chapter":4,"inputs":[["A",4],["B",4],["Cin",1]],"outputs":[["Sum",4],["Cout",1]],"hints":["复用全加器或者两位加法器。","每一级进位都只流向相邻的高位。","四个位串联进位，将四个 Sum 接 JOIN，最高位 Cout 连接输出。"],"rewardName":"Adder4","combinational":{"expect":{"Sum":"(A + B + Cin) mod 16","Cout":"(A + B + Cin) div 16"}}},
  // 019-increment4.json
  {"id":19,"title":"四位自增","caption":"复用加法器","goal":"将 A 加 1，Y 保留四位，Cout 表示从 15 回到 0 时的进位。","formula":"Y + 16Cout = A + 1","chapter":4,"inputs":[["A",4]],"outputs":[["Y",4],["Cout",1]],"hints":["自增可以看成一次固定加法。","CONST 提供固定的 0 或 1，四位常量 1 仅最低位为 1。","给四位加法器输入 A、常量 1 和 Cin=0。"],"rewardName":"Increment4","combinational":{"expect":{"Y":"(A + 1) mod 16","Cout":"A = 15"}}},
  // 020-subtract4.json
  {"id":20,"title":"四位减法","caption":"补码与借位","goal":"Diff 是 A−B 的四位结果；A 小于 B 时 Borrow 为 1。","formula":"Diff = (A − B) mod 16；Borrow = (A < B)","chapter":4,"inputs":[["A",4],["B",4]],"outputs":[["Diff",4],["Borrow",1]],"hints":["减法可转为 A 加上 B 的反码再加 1。","每一位反转 B，把初始进位设为 1。","四位相加的 Sum 就是 Diff；最高位 Cout 反转后得到 Borrow。"],"rewardName":"Subtract4","combinational":{"expect":{"Diff":"(A - B) mod 16","Borrow":"A < B"}}},
];
