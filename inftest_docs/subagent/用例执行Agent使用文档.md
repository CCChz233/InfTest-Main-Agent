Planner Agent调用执行智能体：
- 连上服务器后，有现成的虚拟环境：
conda activate inftest_server
- 进入/root/inftest_execute_agent目录
//执行一条测试用例
python run_API.py execute \
  --user-id u001 \
  --project-id xh \
  --task-id roger \
  --device-case-bind @./device_case_bind.sample.json \
  --used-model glm-4.7 \
  --enable-multimodal-assertion false \
  --enable-multimodal-attribution false
- device_case_bind.sample.json 内容如下：
//device_case_bind.sample.json

{
  "device_case": {
    "SM02G4061977180": {
     "case_step": [
        "退到桌面",
        "打开掌上新华APP",
        "点击首页搜索框",
        "输入关键字“健康”并执行搜索"
      ],
      "case_function_point": "首页搜索",
      "test_scenario": "常规搜索流程",
      "expected_result": [
        "成功退到桌面",
        "APP成功启动并进入首页",
        "搜索框可正常聚焦并输入",
        "返回包含关键字相关的搜索结果列表"
      ],
      "case_id": "roger_case_000"
    }
  }
}